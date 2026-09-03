import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CollectionDispatchStatus,
  Prisma,
  ReceivableStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionEmailService } from './collection-email.service';
import { CreateCollectionRuleDto } from './dto/create-collection-rule.dto';
import { ListCollectionDispatchesQueryDto } from './dto/list-collection-dispatches-query.dto';
import { UpdateCollectionRuleDto } from './dto/update-collection-rule.dto';

interface CollectionActor {
  id: string;
  organizationId: string;
}

const MAX_BATCH_SIZE = 100;
const OPEN_RECEIVABLE_STATUSES = [
  ReceivableStatus.PENDENTE,
  ReceivableStatus.PARCIAL,
];
const RETRYABLE_STATUSES = [
  CollectionDispatchStatus.PENDENTE,
  CollectionDispatchStatus.FALHOU,
];

const DISPATCH_INCLUDE = {
  rule: { select: { id: true, name: true, daysOffset: true } },
  receivable: {
    select: {
      id: true,
      description: true,
      dueDate: true,
      adjustedAmount: true,
      paidAmount: true,
      status: true,
      sale: {
        select: {
          id: true,
          saleNumber: true,
          development: { select: { id: true, name: true } },
          unit: { select: { id: true, identifier: true } },
          buyers: {
            select: {
              isPrimary: true,
              person: { select: { id: true, name: true, email: true } },
            },
            orderBy: [
              { isPrimary: 'desc' as const },
              { createdAt: 'asc' as const },
            ],
          },
        },
      },
    },
  },
} satisfies Prisma.CollectionDispatchInclude;

type DispatchWithContext = Prisma.CollectionDispatchGetPayload<{
  include: typeof DISPATCH_INCLUDE;
}>;

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: CollectionEmailService,
  ) {}

  async listRules(organizationId: string) {
    await this.ensureDefaultRules(organizationId);
    return this.prisma.collectionRule.findMany({
      where: { organizationId },
      orderBy: [{ daysOffset: 'asc' }, { name: 'asc' }],
    });
  }

  async createRule(actor: CollectionActor, dto: CreateCollectionRuleDto) {
    try {
      const rule = await this.prisma.collectionRule.create({
        data: { organizationId: actor.organizationId, ...dto },
      });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.COLLECTION_RULE_CREATED,
        entityType: AUDIT_ENTITY_TYPES.COLLECTION_RULE,
        entityId: rule.id,
        metadata: { daysOffset: rule.daysOffset, active: rule.active },
      });
      return rule;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Já existe uma régua com este nome');
      }
      throw error;
    }
  }

  async updateRule(
    id: string,
    actor: CollectionActor,
    dto: UpdateCollectionRuleDto,
  ) {
    const current = await this.requireRule(id, actor.organizationId);
    try {
      const rule = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.collectionRule.update({
          where: { id },
          data: dto,
        });
        if (dto.active === false) {
          await tx.collectionDispatch.updateMany({
            where: {
              organizationId: actor.organizationId,
              ruleId: id,
              status: { in: RETRYABLE_STATUSES },
            },
            data: {
              status: CollectionDispatchStatus.CANCELADO,
              failureReason: 'Régua desativada',
            },
          });
        }
        return updated;
      });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.COLLECTION_RULE_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.COLLECTION_RULE,
        entityId: id,
        metadata: {
          changedFields: Object.keys(dto),
          oldActive: current.active,
          newActive: rule.active,
        },
      });
      return rule;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Já existe uma régua com este nome');
      }
      throw error;
    }
  }

  async listDispatches(
    organizationId: string,
    query: ListCollectionDispatchesQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CollectionDispatchWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.ruleId ? { ruleId: query.ruleId } : {}),
      ...(query.search
        ? {
            OR: [
              { recipient: { contains: query.search, mode: 'insensitive' } },
              { subject: { contains: query.search, mode: 'insensitive' } },
              {
                receivable: {
                  sale: {
                    buyers: {
                      some: {
                        person: {
                          name: { contains: query.search, mode: 'insensitive' },
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total, grouped] = await Promise.all([
      this.prisma.collectionDispatch.findMany({
        where,
        include: DISPATCH_INCLUDE,
        orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.collectionDispatch.count({ where }),
      this.prisma.collectionDispatch.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(
      grouped.map((item) => [item.status, item._count._all]),
    );
    return {
      data: data.map((item) => this.presentDispatch(item)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      summary: {
        pending:
          (counts[CollectionDispatchStatus.PENDENTE] ?? 0) +
          (counts[CollectionDispatchStatus.ENVIANDO] ?? 0),
        sent: counts[CollectionDispatchStatus.ENVIADO] ?? 0,
        failed: counts[CollectionDispatchStatus.FALHOU] ?? 0,
        cancelled: counts[CollectionDispatchStatus.CANCELADO] ?? 0,
        providerConfigured: this.email.configured,
      },
    };
  }

  async run(organizationId: string, actorUserId: string | null = null) {
    const now = new Date();
    const today = this.startOfUtcDay(now);
    const tomorrow = this.addDays(today, 1);
    const retryBefore = new Date(now.getTime() - 60 * 60 * 1000);
    const staleBefore = new Date(now.getTime() - 30 * 60 * 1000);

    await this.prisma.collectionDispatch.updateMany({
      where: {
        organizationId,
        status: CollectionDispatchStatus.ENVIANDO,
        lastAttemptAt: { lt: staleBefore },
      },
      data: {
        status: CollectionDispatchStatus.FALHOU,
        failureReason: 'Tentativa anterior interrompida',
      },
    });
    const cancelled = await this.prisma.collectionDispatch.updateMany({
      where: {
        organizationId,
        status: { in: RETRYABLE_STATUSES },
        receivable: {
          status: {
            in: [ReceivableStatus.PAGO, ReceivableStatus.CANCELADO],
          },
        },
      },
      data: {
        status: CollectionDispatchStatus.CANCELADO,
        failureReason: 'Recebível quitado ou cancelado',
      },
    });

    const rules = await this.prisma.collectionRule.findMany({
      where: { organizationId, active: true },
    });
    let generated = 0;
    for (const rule of rules) {
      const dueStart = this.addDays(today, -rule.daysOffset);
      const dueEnd = this.addDays(tomorrow, -rule.daysOffset);
      const receivables = await this.prisma.receivable.findMany({
        where: {
          organizationId,
          status: { in: OPEN_RECEIVABLE_STATUSES },
          dueDate: { gte: dueStart, lt: dueEnd },
        },
        include: {
          sale: {
            include: {
              development: { select: { name: true } },
              unit: { select: { identifier: true } },
              buyers: {
                include: { person: true },
                orderBy: [
                  { isPrimary: 'desc' as const },
                  { createdAt: 'asc' as const },
                ],
              },
            },
          },
        },
      });
      if (receivables.length === 0) continue;
      const result = await this.prisma.collectionDispatch.createMany({
        data: receivables.map((receivable) => {
          const buyer = receivable.sale?.buyers[0]?.person;
          const balance = receivable.adjustedAmount.minus(
            receivable.paidAmount,
          );
          const variables = {
            cliente: buyer?.name ?? 'cliente',
            vencimento: this.formatDate(receivable.dueDate),
            valor: this.formatMoney(balance),
            parcela: receivable.description,
            venda: receivable.sale?.saleNumber ?? '',
            empreendimento: receivable.sale?.development.name ?? '',
            unidade: receivable.sale?.unit.identifier ?? '',
          };
          return {
            organizationId,
            ruleId: rule.id,
            receivableId: receivable.id,
            scheduledFor: today,
            recipient: buyer?.email?.trim().toLowerCase() || null,
            subject: this.renderTemplate(rule.subject, variables),
            message: this.renderTemplate(rule.message, variables),
            balanceSnapshot: balance,
          };
        }),
        skipDuplicates: true,
      });
      generated += result.count;
    }

    const candidates = await this.prisma.collectionDispatch.findMany({
      where: {
        organizationId,
        scheduledFor: { lte: now },
        attemptCount: { lt: 3 },
        OR: [
          { status: CollectionDispatchStatus.PENDENTE },
          {
            status: CollectionDispatchStatus.FALHOU,
            lastAttemptAt: { lt: retryBefore },
          },
        ],
      },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: MAX_BATCH_SIZE,
      select: { id: true },
    });
    let sent = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const outcome = await this.sendDispatch(
        candidate.id,
        organizationId,
        actorUserId,
      );
      if (outcome === 'sent') sent += 1;
      if (outcome === 'failed') failed += 1;
    }
    return {
      generated,
      sent,
      failed,
      cancelled: cancelled.count,
      providerConfigured: this.email.configured,
    };
  }

  async retry(id: string, actor: CollectionActor) {
    const dispatch = await this.requireDispatch(id, actor.organizationId);
    if (dispatch.status === CollectionDispatchStatus.ENVIADO) {
      throw new ConflictException('Esta cobrança já foi enviada');
    }
    if (dispatch.status === CollectionDispatchStatus.CANCELADO) {
      throw new ConflictException('Esta cobrança está cancelada');
    }
    await this.prisma.collectionDispatch.update({
      where: { id },
      data: {
        status: CollectionDispatchStatus.PENDENTE,
        attemptCount: 0,
        lastAttemptAt: null,
        failureReason: null,
      },
    });
    await this.sendDispatch(id, actor.organizationId, actor.id);
    return this.presentDispatch(
      await this.requireDispatch(id, actor.organizationId),
    );
  }

  async cancel(id: string, actor: CollectionActor) {
    const dispatch = await this.requireDispatch(id, actor.organizationId);
    if (dispatch.status === CollectionDispatchStatus.ENVIADO) {
      throw new ConflictException(
        'Uma cobrança enviada não pode ser cancelada',
      );
    }
    const updated = await this.prisma.collectionDispatch.update({
      where: { id },
      data: {
        status: CollectionDispatchStatus.CANCELADO,
        failureReason: 'Cancelada manualmente',
      },
      include: DISPATCH_INCLUDE,
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: AUDIT_ACTIONS.COLLECTION_DISPATCH_CANCELLED,
      entityType: AUDIT_ENTITY_TYPES.COLLECTION_DISPATCH,
      entityId: id,
      metadata: { oldStatus: dispatch.status },
    });
    return this.presentDispatch(updated);
  }

  private async sendDispatch(
    id: string,
    organizationId: string,
    actorUserId: string | null,
  ): Promise<'sent' | 'failed' | 'skipped'> {
    const claimed = await this.prisma.collectionDispatch.updateMany({
      where: {
        id,
        organizationId,
        status: { in: RETRYABLE_STATUSES },
        attemptCount: { lt: 3 },
      },
      data: {
        status: CollectionDispatchStatus.ENVIANDO,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        failureReason: null,
      },
    });
    if (claimed.count === 0) return 'skipped';
    const dispatch = await this.requireDispatch(id, organizationId);
    if (!dispatch.recipient) {
      await this.markFailed(id, 'Cliente sem e-mail cadastrado');
      return 'failed';
    }
    try {
      const providerMessageId = await this.email.send({
        dispatchId: id,
        recipient: dispatch.recipient,
        subject: dispatch.subject,
        message: dispatch.message,
      });
      await this.prisma.collectionDispatch.update({
        where: { id },
        data: {
          status: CollectionDispatchStatus.ENVIADO,
          sentAt: new Date(),
          providerMessageId,
          failureReason: null,
        },
      });
      await this.audit.record({
        organizationId,
        actorUserId,
        action: AUDIT_ACTIONS.COLLECTION_DISPATCH_SENT,
        entityType: AUDIT_ENTITY_TYPES.COLLECTION_DISPATCH,
        entityId: id,
        metadata: {
          receivableId: dispatch.receivableId,
          ruleId: dispatch.ruleId,
          attemptCount: dispatch.attemptCount,
        },
      });
      return 'sent';
    } catch (error) {
      await this.markFailed(id, this.errorMessage(error));
      return 'failed';
    }
  }

  private markFailed(id: string, reason: string) {
    return this.prisma.collectionDispatch.update({
      where: { id },
      data: {
        status: CollectionDispatchStatus.FALHOU,
        failureReason: reason.slice(0, 500),
      },
    });
  }

  private async ensureDefaultRules(organizationId: string) {
    const existingRules = await this.prisma.collectionRule.count({
      where: { organizationId },
    });
    if (existingRules > 0) return;
    await this.prisma.collectionRule.createMany({
      data: [
        {
          organizationId,
          name: 'Lembrete 5 dias antes',
          daysOffset: -5,
          subject: 'Lembrete de vencimento — {{parcela}}',
          message:
            'Olá, {{cliente}}. A parcela {{parcela}}, no valor de {{valor}}, vence em {{vencimento}}. Em caso de dúvida, fale com nossa equipe.',
          active: false,
        },
        {
          organizationId,
          name: 'Aviso no vencimento',
          daysOffset: 0,
          subject: 'Vencimento hoje — {{parcela}}',
          message:
            'Olá, {{cliente}}. A parcela {{parcela}}, no valor de {{valor}}, vence hoje. Se o pagamento já foi realizado, desconsidere esta mensagem.',
          active: false,
        },
        {
          organizationId,
          name: 'Cobrança 3 dias após',
          daysOffset: 3,
          subject: 'Parcela em atraso — {{parcela}}',
          message:
            'Olá, {{cliente}}. Não identificamos o pagamento da parcela {{parcela}}, vencida em {{vencimento}}, com saldo de {{valor}}. Por favor, entre em contato para regularização.',
          active: false,
        },
      ],
      skipDuplicates: true,
    });
  }

  private async requireRule(id: string, organizationId: string) {
    const rule = await this.prisma.collectionRule.findFirst({
      where: { id, organizationId },
    });
    if (!rule) throw new NotFoundException('Régua de cobrança não encontrada');
    return rule;
  }

  private async requireDispatch(id: string, organizationId: string) {
    const dispatch = await this.prisma.collectionDispatch.findFirst({
      where: { id, organizationId },
      include: DISPATCH_INCLUDE,
    });
    if (!dispatch) throw new NotFoundException('Cobrança não encontrada');
    return dispatch;
  }

  private presentDispatch(dispatch: DispatchWithContext) {
    const buyer = dispatch.receivable.sale?.buyers[0]?.person;
    const sale = dispatch.receivable.sale;
    const { receivable, ...dispatchFields } = dispatch;
    return {
      ...dispatchFields,
      balanceSnapshot: dispatch.balanceSnapshot.toFixed(2),
      customer: buyer ? { id: buyer.id, name: buyer.name } : null,
      receivable: {
        id: receivable.id,
        description: receivable.description,
        dueDate: receivable.dueDate,
        status: receivable.status,
        adjustedAmount: receivable.adjustedAmount.toFixed(2),
        paidAmount: receivable.paidAmount.toFixed(2),
        balance: receivable.adjustedAmount
          .minus(receivable.paidAmount)
          .toFixed(2),
        sale: sale
          ? {
              id: sale.id,
              saleNumber: sale.saleNumber,
              development: sale.development,
              unit: sale.unit,
            }
          : null,
      },
    };
  }

  private renderTemplate(template: string, variables: Record<string, string>) {
    return template.replace(/{{\s*([a-z]+)\s*}}/gi, (token, key: string) =>
      Object.hasOwn(variables, key.toLowerCase())
        ? variables[key.toLowerCase()]
        : token,
    );
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
  }

  private formatMoney(value: Prisma.Decimal) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value.toNumber());
  }

  private startOfUtcDay(date: Date) {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 86_400_000);
  }

  private errorMessage(error: unknown) {
    return error instanceof Error
      ? error.message
      : 'Falha desconhecida no envio';
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
