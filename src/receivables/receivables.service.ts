import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankReconciliationStatus,
  Prisma,
  ProposalPaymentConditionType,
  ReceivableSourceType,
  ReceivableStatus,
  FinancialTransactionType,
  SaleStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancelReceivableDto } from './dto/cancel-receivable.dto';
import { ListReceivablesQueryDto } from './dto/list-receivables-query.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import {
  getComputedReceivableStatus,
  startOfUtcDay,
} from './receivable-status';

interface ReceivableActor {
  id: string;
  organizationId: string;
}

export interface ReceivableSaleSource {
  id: string;
  organizationId: string;
  companyId: string | null;
  saleNumber: string;
  saleDate: Date;
  expectedDeliveryDate: Date | null;
}

export interface ReceivablePlanSource {
  id: string;
  type: ProposalPaymentConditionType;
  amount: Prisma.Decimal;
  installments: number | null;
  firstDueDate: Date | null;
  intervalMonths: number | null;
  description: string | null;
  position: number;
}

interface LockedReceivable {
  id: string;
  saleId: string | null;
  companyId: string | null;
  description: string;
  adjustedAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  status: ReceivableStatus;
}

interface LockedPayment {
  id: string;
  amount: Prisma.Decimal;
  reversedAt: Date | null;
}

interface LockedFinancialSale {
  id: string;
  status: SaleStatus;
}

const RECEIVABLE_INCLUDE = {
  company: { select: { id: true, name: true } },
  bankAccount: {
    select: { id: true, bank: true, agency: true, account: true },
  },
  sale: {
    select: {
      id: true,
      saleNumber: true,
      status: true,
      development: { select: { id: true, name: true } },
      unit: { select: { id: true, identifier: true, grouping: true } },
      buyers: {
        select: {
          isPrimary: true,
          person: { select: { id: true, name: true } },
        },
        orderBy: [
          { isPrimary: 'desc' as const },
          { createdAt: 'asc' as const },
        ],
      },
    },
  },
  payments: {
    include: {
      bankAccount: {
        select: { id: true, bank: true, agency: true, account: true },
      },
      createdByUser: { select: { id: true, name: true } },
      reversedByUser: { select: { id: true, name: true } },
    },
    orderBy: [{ paidAt: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.ReceivableInclude;

type ReceivableWithContext = Prisma.ReceivableGetPayload<{
  include: typeof RECEIVABLE_INCLUDE;
}>;

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: string, query: ListReceivablesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(organizationId, query);
    const [data, total, summary] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        include: RECEIVABLE_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.receivable.count({ where }),
      this.summary(organizationId, query.startDate, query.endDate),
    ]);

    return {
      data: data.map((receivable) => this.present(receivable)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      summary,
    };
  }

  async findOne(id: string, organizationId: string) {
    const receivable = await this.prisma.receivable.findFirst({
      where: { id, organizationId },
      include: RECEIVABLE_INCLUDE,
    });
    if (!receivable) throw new NotFoundException('Recebível não encontrado');
    return this.present(receivable);
  }

  async findForSale(saleId: string, organizationId: string) {
    const receivables = await this.prisma.receivable.findMany({
      where: { saleId, organizationId },
      include: RECEIVABLE_INCLUDE,
      orderBy: [{ dueDate: 'asc' }, { sourceSequence: 'asc' }],
    });
    return receivables.map((receivable) => this.present(receivable));
  }

  async generateForSale(
    sale: ReceivableSaleSource,
    plans: ReceivablePlanSource[],
    actorUserId: string,
    tx: Prisma.TransactionClient,
  ) {
    const existing = await tx.receivable.findMany({
      where: {
        organizationId: sale.organizationId,
        sourceType: ReceivableSourceType.SALE_PAYMENT_PLAN,
        sourceId: { in: plans.map((plan) => plan.id) },
      },
      select: { sourceId: true, sourceSequence: true },
    });
    const existingKeys = new Set(
      existing.map((item) => `${item.sourceId}:${item.sourceSequence}`),
    );
    const created: Prisma.ReceivableGetPayload<Record<string, never>>[] = [];

    for (const plan of plans) {
      const count =
        plan.type === ProposalPaymentConditionType.PARCELAS
          ? (plan.installments ?? 1)
          : 1;
      const amounts = this.splitAmount(plan.amount, count);
      const firstDueDate = this.firstDueDate(sale, plan);

      for (let index = 0; index < count; index += 1) {
        const sourceSequence = index + 1;
        if (existingKeys.has(`${plan.id}:${sourceSequence}`)) continue;
        const amount = amounts[index];
        const receivable = await tx.receivable.create({
          data: {
            organizationId: sale.organizationId,
            companyId: sale.companyId,
            saleId: sale.id,
            salePaymentPlanId: plan.id,
            sourceType: ReceivableSourceType.SALE_PAYMENT_PLAN,
            sourceId: plan.id,
            sourceSequence,
            description: this.description(plan, sourceSequence, count),
            dueDate: this.addUtcMonths(
              firstDueDate,
              index * (plan.intervalMonths ?? 1),
            ),
            originalAmount: amount,
            adjustedAmount: amount,
          },
        });
        created.push(receivable);
      }
    }

    if (created.length > 0) {
      await this.audit.recordMany(
        created.map((receivable) => ({
          organizationId: sale.organizationId,
          actorUserId,
          action: AUDIT_ACTIONS.RECEIVABLE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.RECEIVABLE,
          entityId: receivable.id,
          metadata: {
            saleId: sale.id,
            sourceType: receivable.sourceType,
            sourceSequence: receivable.sourceSequence,
            dueDate: receivable.dueDate.toISOString(),
          },
        })),
        tx,
      );
    }

    return created;
  }

  async recordPayment(
    id: string,
    actor: ReceivableActor,
    dto: RecordPaymentDto,
  ) {
    const paidAt = new Date(dto.paidAt);
    if (paidAt.getTime() > Date.now()) {
      throw new BadRequestException(
        'A data do pagamento não pode estar no futuro',
      );
    }
    const amount = new Prisma.Decimal(dto.amount);

    await this.prisma.$transaction(async (tx) => {
      const receivable = await this.lockReceivable(
        tx,
        id,
        actor.organizationId,
      );
      if (receivable.status === ReceivableStatus.CANCELADO) {
        throw new ConflictException('O recebível está cancelado');
      }
      if (receivable.status === ReceivableStatus.PAGO) {
        throw new ConflictException('O recebível já está pago');
      }
      const balance = receivable.adjustedAmount.minus(receivable.paidAmount);
      if (amount.greaterThan(balance)) {
        throw new BadRequestException(
          'O pagamento não pode exceder o saldo do recebível',
        );
      }
      const bankAccount = await this.requireBankAccount(
        tx,
        dto.bankAccountId,
        actor.organizationId,
      );
      const context = await this.transactionContext(
        tx,
        receivable,
        bankAccount.companyId,
        actor.organizationId,
      );

      const payment = await tx.financialPayment.create({
        data: {
          organizationId: actor.organizationId,
          receivableId: receivable.id,
          bankAccountId: bankAccount.id,
          amount,
          paidAt,
          notes: dto.notes || null,
          createdByUserId: actor.id,
        },
      });
      const transaction = await tx.financialTransaction.create({
        data: {
          organizationId: actor.organizationId,
          paymentId: payment.id,
          receivableId: receivable.id,
          bankAccountId: bankAccount.id,
          companyId: context.companyId,
          developmentId: context.developmentId,
          costCenterId: context.costCenterId,
          type: FinancialTransactionType.ENTRADA,
          amount,
          date: paidAt,
          description: receivable.description,
        },
      });
      const paidAmount = receivable.paidAmount.plus(amount);
      const status = paidAmount.equals(receivable.adjustedAmount)
        ? ReceivableStatus.PAGO
        : ReceivableStatus.PARCIAL;
      await tx.receivable.update({
        where: { id: receivable.id },
        data: {
          paidAmount,
          status,
          paidAt: status === ReceivableStatus.PAGO ? paidAt : null,
          bankAccountId: bankAccount.id,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PAYMENT_RECORDED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_PAYMENT,
          entityId: payment.id,
          metadata: {
            receivableId: receivable.id,
            saleId: receivable.saleId,
            amount: amount.toFixed(2),
            oldStatus: receivable.status,
            newStatus: status,
          },
        },
        tx,
      );
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.FINANCIAL_TRANSACTION_CREATED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_TRANSACTION,
          entityId: transaction.id,
          metadata: { receivableId: receivable.id, paymentId: payment.id },
        },
        tx,
      );
      await this.syncSaleStatus(tx, receivable.saleId, actor);
    });

    return this.findOne(id, actor.organizationId);
  }

  async reversePayment(
    id: string,
    paymentId: string,
    actor: ReceivableActor,
    dto: ReversePaymentDto,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const receivable = await this.lockReceivable(
        tx,
        id,
        actor.organizationId,
      );
      const payment = await this.lockPayment(
        tx,
        paymentId,
        receivable.id,
        actor.organizationId,
      );
      if (payment.reversedAt) {
        throw new ConflictException('O pagamento já foi estornado');
      }
      const paidAmount = receivable.paidAmount.minus(payment.amount);
      if (paidAmount.lessThan(0)) {
        throw new ConflictException(
          'O histórico de pagamentos do recebível está inconsistente',
        );
      }
      const status = paidAmount.equals(0)
        ? ReceivableStatus.PENDENTE
        : ReceivableStatus.PARCIAL;
      const reversedAt = new Date();
      await tx.financialPayment.update({
        where: { id: payment.id },
        data: {
          reversedAt,
          reversedByUserId: actor.id,
          reversalReason: dto.reason,
        },
      });
      const transaction = await tx.financialTransaction.update({
        where: { paymentId: payment.id },
        data: { reversedAt },
      });
      const reconciliation = await tx.bankStatementEntry.updateMany({
        where: { matchedTransactionId: transaction.id },
        data: {
          status: BankReconciliationStatus.PENDENTE,
          matchedTransactionId: null,
          reconciledAt: null,
        },
      });
      await tx.receivable.update({
        where: { id: receivable.id },
        data: { paidAmount, status, paidAt: null },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PAYMENT_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_PAYMENT,
          entityId: payment.id,
          metadata: {
            receivableId: receivable.id,
            saleId: receivable.saleId,
            amount: payment.amount.toFixed(2),
            oldStatus: receivable.status,
            newStatus: status,
            reason: dto.reason,
          },
        },
        tx,
      );
      if (reconciliation.count) {
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.BANK_TRANSACTION_UNMATCHED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_TRANSACTION,
            entityId: transaction.id,
            metadata: { reason: 'PAYMENT_REVERSED' },
          },
          tx,
        );
      }
      await this.syncSaleStatus(tx, receivable.saleId, actor);
    });

    return this.findOne(id, actor.organizationId);
  }

  async cancel(id: string, actor: ReceivableActor, dto: CancelReceivableDto) {
    await this.prisma.$transaction(async (tx) => {
      const receivable = await this.lockReceivable(
        tx,
        id,
        actor.organizationId,
      );
      if (receivable.status === ReceivableStatus.CANCELADO) {
        return;
      }
      if (!receivable.paidAmount.equals(0)) {
        throw new ConflictException(
          'Estorne os pagamentos antes de cancelar o recebível',
        );
      }
      await tx.receivable.update({
        where: { id: receivable.id },
        data: {
          status: ReceivableStatus.CANCELADO,
          cancelledAt: new Date(),
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.RECEIVABLE_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.RECEIVABLE,
          entityId: receivable.id,
          metadata: { saleId: receivable.saleId, reason: dto.reason },
        },
        tx,
      );
      await this.syncSaleStatus(tx, receivable.saleId, actor);
    });

    return this.findOne(id, actor.organizationId);
  }

  private buildWhere(
    organizationId: string,
    query: ListReceivablesQueryDto,
  ): Prisma.ReceivableWhereInput {
    const today = startOfUtcDay();
    const where: Prisma.ReceivableWhereInput = {
      organizationId,
      ...(query.saleId ? { saleId: query.saleId } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.developmentId
        ? { sale: { developmentId: query.developmentId } }
        : {}),
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(query.buyerId
        ? { sale: { buyers: { some: { personId: query.buyerId } } } }
        : {}),
    };

    if (query.status === 'ATRASADO') {
      where.status = {
        in: [ReceivableStatus.PENDENTE, ReceivableStatus.PARCIAL],
      };
      where.dueDate = { lt: today };
    } else if (query.status === 'PENDENTE') {
      where.status = ReceivableStatus.PENDENTE;
      where.dueDate = { gte: today };
    } else if (query.status === 'PARCIAL') {
      where.status = ReceivableStatus.PARCIAL;
      where.dueDate = { gte: today };
    } else if (query.status) {
      where.status = query.status as ReceivableStatus;
    }

    const dueDate = this.dateRange(query.startDate, query.endDate);
    if (dueDate) {
      where.dueDate = {
        ...(typeof where.dueDate === 'object' ? where.dueDate : {}),
        ...dueDate,
      };
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        {
          sale: {
            saleNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          sale: {
            unit: {
              identifier: { contains: query.search, mode: 'insensitive' },
            },
          },
        },
        {
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
      ];
    }
    return where;
  }

  private async summary(
    organizationId: string,
    startDate?: string,
    endDate?: string,
  ) {
    const now = new Date();
    const today = startOfUtcDay(now);
    const nextThirtyDays = new Date(today);
    nextThirtyDays.setUTCDate(nextThirtyDays.getUTCDate() + 30);
    const periodStart = startDate
      ? new Date(`${startDate}T00:00:00.000Z`)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = endDate
      ? this.nextUtcDay(new Date(`${endDate}T00:00:00.000Z`))
      : now;
    if (periodStart >= periodEnd) {
      throw new BadRequestException(
        'startDate deve ser anterior ou igual a endDate',
      );
    }
    const [open, received] = await Promise.all([
      this.prisma.receivable.findMany({
        where: {
          organizationId,
          status: { not: ReceivableStatus.CANCELADO },
        },
        select: {
          dueDate: true,
          adjustedAmount: true,
          paidAmount: true,
          status: true,
        },
      }),
      this.prisma.financialPayment.aggregate({
        where: {
          organizationId,
          reversedAt: null,
          paidAt: { gte: periodStart, lt: periodEnd },
        },
        _sum: { amount: true },
      }),
    ]);
    const zero = new Prisma.Decimal(0);
    const outstanding = open.reduce(
      (sum, item) => sum.plus(item.adjustedAmount.minus(item.paidAmount)),
      zero,
    );
    const overdue = open.reduce(
      (sum, item) =>
        getComputedReceivableStatus(item.status, item.dueDate, now) ===
        'ATRASADO'
          ? sum.plus(item.adjustedAmount.minus(item.paidAmount))
          : sum,
      zero,
    );
    const dueNext30Days = open.reduce(
      (sum, item) =>
        item.dueDate >= today && item.dueDate < nextThirtyDays
          ? sum.plus(item.adjustedAmount.minus(item.paidAmount))
          : sum,
      zero,
    );
    return {
      outstanding: outstanding.toFixed(2),
      receivedInPeriod: (received._sum.amount ?? zero).toFixed(2),
      overdue: overdue.toFixed(2),
      dueNext30Days: dueNext30Days.toFixed(2),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    };
  }

  private present(receivable: ReceivableWithContext) {
    return {
      ...receivable,
      status: getComputedReceivableStatus(
        receivable.status,
        receivable.dueDate,
      ),
      persistedStatus: receivable.status,
      balance: receivable.adjustedAmount.minus(receivable.paidAmount),
    };
  }

  private splitAmount(amount: Prisma.Decimal, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 600) {
      throw new ConflictException(
        'O número de parcelas deve estar entre 1 e 600',
      );
    }
    const totalCents = BigInt(amount.times(100).toFixed(0));
    if (totalCents < BigInt(count)) {
      throw new ConflictException(
        'O valor total deve permitir ao menos um centavo por parcela',
      );
    }
    const divisor = BigInt(count);
    const baseCents = totalCents / divisor;
    return Array.from({ length: count }, (_, index) => {
      const cents =
        index === count - 1
          ? totalCents - baseCents * BigInt(count - 1)
          : baseCents;
      return new Prisma.Decimal(cents.toString()).dividedBy(100);
    });
  }

  private firstDueDate(sale: ReceivableSaleSource, plan: ReceivablePlanSource) {
    if (plan.firstDueDate) return plan.firstDueDate;
    if (
      plan.type === ProposalPaymentConditionType.SALDO_CHAVES &&
      sale.expectedDeliveryDate
    ) {
      return sale.expectedDeliveryDate;
    }
    return sale.saleDate;
  }

  private description(
    plan: ReceivablePlanSource,
    sequence: number,
    count: number,
  ) {
    if (plan.description?.trim()) return plan.description.trim();
    if (plan.type === ProposalPaymentConditionType.ENTRADA) return 'Entrada';
    if (plan.type === ProposalPaymentConditionType.PARCELAS) {
      return `Parcela ${String(sequence).padStart(2, '0')}/${count}`;
    }
    if (plan.type === ProposalPaymentConditionType.SALDO_CHAVES) {
      return 'Saldo nas chaves';
    }
    if (plan.type === ProposalPaymentConditionType.FINANCIAMENTO) {
      return 'Financiamento';
    }
    return 'Outro recebível';
  }

  private addUtcMonths(date: Date, months: number) {
    const targetYear = date.getUTCFullYear();
    const targetMonth = date.getUTCMonth() + months;
    const lastDay = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();
    return new Date(
      Date.UTC(
        targetYear,
        targetMonth,
        Math.min(date.getUTCDate(), lastDay),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds(),
      ),
    );
  }

  private dateRange(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return undefined;
    const start = startDate
      ? new Date(`${startDate}T00:00:00.000Z`)
      : undefined;
    const end = endDate
      ? this.nextUtcDay(new Date(`${endDate}T00:00:00.000Z`))
      : undefined;
    if (start && end && start >= end) {
      throw new BadRequestException(
        'startDate deve ser anterior ou igual a endDate',
      );
    }
    return {
      ...(start ? { gte: start } : {}),
      ...(end ? { lt: end } : {}),
    };
  }

  private nextUtcDay(date: Date) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  private async requireBankAccount(
    tx: Prisma.TransactionClient,
    bankAccountId: string,
    organizationId: string,
  ) {
    const bankAccount = await tx.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
      select: { id: true, companyId: true },
    });
    if (!bankAccount) {
      throw new BadRequestException(
        'Conta bancária inválida para esta organização',
      );
    }
    return bankAccount;
  }

  private async lockReceivable(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [receivable] = await tx.$queryRaw<LockedReceivable[]>`
      SELECT "id", "saleId", "companyId", "description", "adjustedAmount", "paidAmount", "status"
      FROM "Receivable"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!receivable) throw new NotFoundException('Recebível não encontrado');
    return receivable;
  }

  private async lockPayment(
    tx: Prisma.TransactionClient,
    id: string,
    receivableId: string,
    organizationId: string,
  ) {
    const [payment] = await tx.$queryRaw<LockedPayment[]>`
      SELECT "id", "amount", "reversedAt"
      FROM "FinancialPayment"
      WHERE "id" = ${id}
        AND "receivableId" = ${receivableId}
        AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    return payment;
  }

  private async transactionContext(
    tx: Prisma.TransactionClient,
    receivable: LockedReceivable,
    bankCompanyId: string | null,
    organizationId: string,
  ) {
    const sale = receivable.saleId
      ? await tx.sale.findFirst({
          where: { id: receivable.saleId, organizationId },
          select: { developmentId: true },
        })
      : null;
    const companyId = receivable.companyId ?? bankCompanyId;
    const costCenter = await tx.costCenter.findFirst({
      where: {
        organizationId,
        ...(sale?.developmentId
          ? { developmentId: sale.developmentId }
          : companyId
            ? { companyId }
            : {}),
        active: true,
      },
      select: { id: true },
    });
    return {
      companyId,
      developmentId: sale?.developmentId ?? null,
      costCenterId: costCenter?.id ?? null,
    };
  }

  private async syncSaleStatus(
    tx: Prisma.TransactionClient,
    saleId: string | null,
    actor: ReceivableActor,
  ) {
    if (!saleId) return;
    const [sale] = await tx.$queryRaw<LockedFinancialSale[]>`
      SELECT "id", "status"
      FROM "Sale"
      WHERE "id" = ${saleId} AND "organizationId" = ${actor.organizationId}
      FOR UPDATE
    `;
    if (
      !sale ||
      (sale.status !== SaleStatus.ATIVA && sale.status !== SaleStatus.QUITADA)
    ) {
      return;
    }
    const receivables = await tx.receivable.findMany({
      where: {
        saleId,
        organizationId: actor.organizationId,
        status: { not: ReceivableStatus.CANCELADO },
      },
      select: { status: true },
    });
    const nextStatus =
      receivables.length > 0 &&
      receivables.every(({ status }) => status === ReceivableStatus.PAGO)
        ? SaleStatus.QUITADA
        : SaleStatus.ATIVA;
    if (sale.status === nextStatus) return;

    await tx.sale.update({
      where: { id: sale.id },
      data: { status: nextStatus },
    });
    await this.audit.record(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.SALE_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.SALE,
        entityId: sale.id,
        metadata: {
          changedFields: ['status'],
          oldStatus: sale.status,
          newStatus: nextStatus,
          source: 'RECEIVABLES',
        },
      },
      tx,
    );
  }
}
