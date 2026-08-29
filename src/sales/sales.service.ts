import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PersonRoleType,
  Prisma,
  SaleCommissionStatus,
  SalesProposalStatus,
  SaleStatus,
  UnitReservationStatus,
  UnitStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditEntry, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConvertProposalToSaleDto } from './dto/convert-proposal-to-sale.dto';
import { CreateSaleCommissionDto } from './dto/create-sale-commission.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { SaleBuyerDto } from './dto/sale-buyer.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';

interface SaleActor {
  id: string;
  organizationId: string;
}

interface LockedUnit {
  id: string;
  developmentId: string;
  status: UnitStatus;
}

interface LockedProposal {
  id: string;
  opportunityId: string | null;
  reservationId: string | null;
  personId: string;
  unitId: string;
  status: SalesProposalStatus;
  currentVersionId: string | null;
  convertedToSaleAt: Date | null;
}

interface LockedReservation {
  id: string;
  opportunityId: string | null;
  personId: string;
  unitId: string;
  status: UnitReservationStatus;
  expiresAt: Date;
}

interface LockedOpportunity {
  id: string;
  pipelineId: string;
  stageId: string;
  personId: string;
  developmentId: string | null;
  unitId: string | null;
}

interface LockedSale {
  id: string;
  status: SaleStatus;
}

const SALE_INCLUDE = {
  development: { select: { id: true, name: true } },
  unit: {
    select: {
      id: true,
      identifier: true,
      status: true,
      category: true,
      grouping: true,
    },
  },
  opportunity: {
    select: {
      id: true,
      stage: { select: { id: true, name: true, code: true } },
    },
  },
  proposal: {
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      convertedToSaleAt: true,
    },
  },
  createdByUser: { select: { id: true, name: true } },
  buyers: {
    include: {
      person: {
        select: {
          id: true,
          name: true,
          document: true,
          documentType: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
  },
  paymentPlan: { orderBy: { position: 'asc' as const } },
  commissions: {
    include: {
      person: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SaleInclude;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: string, query: ListSalesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const saleDate = this.dateRange(query.startDate, query.endDate);
    const where: Prisma.SaleWhereInput = {
      organizationId,
      ...(query.developmentId ? { developmentId: query.developmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.buyerId
        ? { buyers: { some: { personId: query.buyerId } } }
        : {}),
      ...(saleDate ? { saleDate } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                saleNumber: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                unit: {
                  identifier: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
              {
                buyers: {
                  some: {
                    person: {
                      name: {
                        contains: query.search.trim(),
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: SALE_INCLUDE,
        orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.sale.count({ where }),
    ]);
    return {
      data: data.map((sale) => this.presentSale(sale)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string, organizationId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, organizationId },
      include: SALE_INCLUDE,
    });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    const buyerIds = sale.buyers.map((buyer) => buyer.personId);
    const [documents, audit] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          organizationId,
          investmentId: null,
          OR: [
            { unitId: sale.unitId },
            { developmentId: sale.developmentId },
            ...(buyerIds.length > 0 ? [{ personId: { in: buyerIds } }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          originalName: true,
          mimeType: true,
          size: true,
          category: true,
          personId: true,
          unitId: true,
          developmentId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.audit.findAll(organizationId, {
        entityType: AUDIT_ENTITY_TYPES.SALE,
        entityId: sale.id,
        page: 1,
        pageSize: 10,
      }),
    ]);
    return { ...this.presentSale(sale), documents, audit: audit.data };
  }

  async convertProposal(
    proposalId: string,
    actor: SaleActor,
    dto: ConvertProposalToSaleDto,
  ) {
    this.validateBuyerShape(dto.buyers);
    this.validateCommissionShape(dto.commissions ?? []);
    const candidate = await this.prisma.salesProposal.findFirst({
      where: { id: proposalId, organizationId: actor.organizationId },
      select: { unitId: true, reservationId: true },
    });
    if (!candidate) throw new NotFoundException('Proposta não encontrada');

    try {
      const saleId = await this.prisma.$transaction(async (tx) => {
        const unit = await this.lockUnit(
          tx,
          candidate.unitId,
          actor.organizationId,
        );
        const reservation = candidate.reservationId
          ? await this.lockReservation(
              tx,
              candidate.reservationId,
              actor.organizationId,
            )
          : null;
        const proposal = await this.lockProposal(
          tx,
          proposalId,
          actor.organizationId,
        );
        const existing = await tx.sale.findFirst({
          where: {
            proposalId: proposal.id,
            organizationId: actor.organizationId,
          },
          select: { id: true },
        });
        if (existing) return existing.id;
        if (
          proposal.status !== SalesProposalStatus.ACEITA ||
          !proposal.currentVersionId
        ) {
          throw new ConflictException(
            'Somente propostas aceitas podem ser convertidas em venda',
          );
        }
        if (proposal.convertedToSaleAt) {
          throw new ConflictException('A proposta já foi convertida em venda');
        }
        if (
          proposal.unitId !== unit.id ||
          unit.status !== UnitStatus.RESERVADA
        ) {
          throw new ConflictException(
            'A unidade precisa estar reservada para a proposta aceita',
          );
        }
        if (!reservation) {
          throw new ConflictException(
            'A proposta aceita não possui reserva de origem',
          );
        }
        this.validateReservation(reservation, proposal);
        const activeSale = await tx.sale.findFirst({
          where: {
            organizationId: actor.organizationId,
            unitId: unit.id,
            status: { in: [SaleStatus.ATIVA, SaleStatus.QUITADA] },
          },
          select: { id: true },
        });
        if (activeSale) {
          throw new ConflictException('A unidade já possui uma venda ativa');
        }

        const version = await tx.proposalVersion.findFirst({
          where: {
            id: proposal.currentVersionId,
            proposalId: proposal.id,
            organizationId: actor.organizationId,
          },
          include: { conditions: { orderBy: { position: 'asc' } } },
        });
        if (!version) {
          throw new ConflictException('A versão aceita da proposta não existe');
        }
        this.assertPaymentPlan(version.finalPrice, version.conditions);
        const buyers = await this.validateBuyerTenancy(
          tx,
          actor.organizationId,
          proposal.personId,
          dto.buyers,
        );
        const commissions = await this.validateCommissionTenancy(
          tx,
          actor.organizationId,
          dto.commissions ?? [],
        );

        const auditEntries: AuditEntry[] = [];
        if (reservation.status === UnitReservationStatus.ATIVA) {
          await tx.unitReservation.update({
            where: { id: reservation.id },
            data: {
              status: UnitReservationStatus.CONVERTIDA,
              convertedAt: new Date(),
              convertedByUserId: actor.id,
            },
          });
          auditEntries.push({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.UNIT_RESERVATION_CONVERTED,
            entityType: AUDIT_ENTITY_TYPES.UNIT_RESERVATION,
            entityId: reservation.id,
            metadata: { unitId: unit.id, proposalId: proposal.id },
          });
        }

        if (proposal.opportunityId) {
          await this.ensureOpportunityWon(
            tx,
            proposal,
            unit,
            actor,
            auditEntries,
          );
        }
        const sale = await tx.sale.create({
          data: {
            organizationId: actor.organizationId,
            developmentId: unit.developmentId,
            unitId: unit.id,
            opportunityId: proposal.opportunityId,
            proposalId: proposal.id,
            saleNumber: dto.saleNumber || this.generateSaleNumber(),
            saleDate: dto.saleDate ? new Date(dto.saleDate) : new Date(),
            grossAmount: version.basePrice,
            discountAmount: version.discount,
            netAmount: version.finalPrice,
            notes: dto.notes || null,
            createdByUserId: actor.id,
            buyers: {
              create: buyers.map((buyer) => ({
                organizationId: actor.organizationId,
                personId: buyer.personId,
                participationPercentage: buyer.participationPercentage,
                isPrimary: buyer.isPrimary,
              })),
            },
            paymentPlan: {
              create: version.conditions.map((condition) => ({
                organizationId: actor.organizationId,
                type: condition.type,
                amount: condition.amount,
                installments: condition.installments,
                firstDueDate: condition.firstDueDate,
                intervalMonths: condition.intervalMonths,
                description: condition.description,
                position: condition.position,
              })),
            },
            commissions: {
              create: commissions.map((commission) => ({
                organizationId: actor.organizationId,
                personId: commission.personId,
                userId: commission.userId,
                percentage: commission.percentage,
                amount: commission.amount,
                status: SaleCommissionStatus.PREVISTA,
                notes: commission.notes,
              })),
            },
          },
          include: {
            buyers: { select: { id: true, personId: true, isPrimary: true } },
            commissions: { select: { id: true, personId: true, userId: true } },
          },
        });
        const convertedAt = new Date();
        await tx.salesProposal.update({
          where: { id: proposal.id },
          data: {
            convertedToSaleAt: convertedAt,
            convertedToSaleByUserId: actor.id,
          },
        });
        await tx.unit.update({
          where: { id: unit.id },
          data: { status: UnitStatus.VENDIDA },
        });
        auditEntries.push(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.SALE_CREATED,
            entityType: AUDIT_ENTITY_TYPES.SALE,
            entityId: sale.id,
            metadata: {
              proposalId: proposal.id,
              unitId: unit.id,
              saleNumber: sale.saleNumber,
              buyerCount: sale.buyers.length,
            },
          },
          ...sale.buyers.map((buyer) => ({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.SALE_BUYER_ADDED,
            entityType: AUDIT_ENTITY_TYPES.SALE,
            entityId: sale.id,
            metadata: {
              saleBuyerId: buyer.id,
              personId: buyer.personId,
              isPrimary: buyer.isPrimary,
            },
          })),
          ...sale.commissions.map((commission) => ({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.SALE_COMMISSION_CREATED,
            entityType: AUDIT_ENTITY_TYPES.SALE,
            entityId: sale.id,
            metadata: {
              commissionId: commission.id,
              beneficiaryType: commission.personId ? 'PERSON' : 'USER',
            },
          })),
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.PROPOSAL_CONVERTED_TO_SALE,
            entityType: AUDIT_ENTITY_TYPES.SALES_PROPOSAL,
            entityId: proposal.id,
            metadata: { saleId: sale.id, unitId: unit.id },
          },
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.UPDATE,
            entityType: AUDIT_ENTITY_TYPES.UNIT,
            entityId: unit.id,
            metadata: {
              changedFields: ['status'],
              oldStatus: unit.status,
              newStatus: UnitStatus.VENDIDA,
              saleId: sale.id,
            },
          },
        );
        await this.audit.recordMany(auditEntries, tx);
        return sale.id;
      });
      return this.findOne(saleId, actor.organizationId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A venda já foi registrada ou o número informado está em uso',
        );
      }
      throw error;
    }
  }

  async update(id: string, actor: SaleActor, dto: UpdateSaleDto) {
    const changedFields = Object.keys(dto).filter(
      (field) => dto[field as keyof UpdateSaleDto] !== undefined,
    );
    if (changedFields.length === 0) {
      throw new BadRequestException('Informe ao menos um campo para atualizar');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockSale(tx, id, actor.organizationId);
        await tx.sale.update({
          where: { id },
          data: {
            saleNumber: dto.saleNumber,
            saleDate: dto.saleDate ? new Date(dto.saleDate) : undefined,
            notes: dto.notes === undefined ? undefined : dto.notes || null,
          },
        });
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.SALE_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.SALE,
            entityId: id,
            metadata: { changedFields },
          },
          tx,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('O número da venda já está em uso');
      }
      throw error;
    }
    return this.findOne(id, actor.organizationId);
  }

  async addCommission(
    id: string,
    actor: SaleActor,
    dto: CreateSaleCommissionDto,
  ) {
    this.validateCommissionShape([dto]);
    const commissionId = await this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, id, actor.organizationId);
      if (
        sale.status === SaleStatus.CANCELADA ||
        sale.status === SaleStatus.DISTRATADA
      ) {
        throw new ConflictException(
          'Não é possível adicionar comissão a esta venda',
        );
      }
      const [commission] = await this.validateCommissionTenancy(
        tx,
        actor.organizationId,
        [dto],
      );
      const created = await tx.saleCommission.create({
        data: {
          organizationId: actor.organizationId,
          saleId: id,
          personId: commission.personId,
          userId: commission.userId,
          percentage: commission.percentage,
          amount: commission.amount,
          notes: commission.notes,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.SALE_COMMISSION_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SALE,
          entityId: id,
          metadata: {
            commissionId: created.id,
            beneficiaryType: created.personId ? 'PERSON' : 'USER',
          },
        },
        tx,
      );
      return created.id;
    });
    const sale = await this.findOne(id, actor.organizationId);
    return sale.commissions.find(
      (commission) => commission.id === commissionId,
    );
  }

  private presentSale<
    T extends { status: SaleStatus; netAmount: Prisma.Decimal },
  >(sale: T) {
    return {
      ...sale,
      outstandingBalance:
        sale.status === SaleStatus.ATIVA
          ? sale.netAmount
          : new Prisma.Decimal(0),
    };
  }

  private validateBuyerShape(buyers: SaleBuyerDto[]) {
    const ids = buyers.map((buyer) => buyer.personId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Não repita compradores na mesma venda');
    }
    if (buyers.filter((buyer) => buyer.isPrimary).length !== 1) {
      throw new BadRequestException(
        'Informe exatamente um comprador principal',
      );
    }
    const withPercentage = buyers.filter(
      (buyer) => buyer.participationPercentage !== undefined,
    );
    if (withPercentage.length > 0 && withPercentage.length !== buyers.length) {
      throw new BadRequestException(
        'Informe a participação de todos os compradores ou de nenhum',
      );
    }
    if (withPercentage.length > 0) {
      const total = buyers.reduce(
        (sum, buyer) =>
          sum.plus(new Prisma.Decimal(buyer.participationPercentage!)),
        new Prisma.Decimal(0),
      );
      if (!total.equals(100)) {
        throw new BadRequestException(
          'A participação dos compradores deve somar 100%',
        );
      }
    }
  }

  private validateCommissionShape(commissions: CreateSaleCommissionDto[]) {
    for (const commission of commissions) {
      if (Boolean(commission.personId) === Boolean(commission.userId)) {
        throw new BadRequestException(
          'Informe uma pessoa ou um usuário como beneficiário da comissão',
        );
      }
    }
  }

  private async validateBuyerTenancy(
    tx: Prisma.TransactionClient,
    organizationId: string,
    proposalPersonId: string,
    buyers: SaleBuyerDto[],
  ) {
    const people = await tx.person.findMany({
      where: {
        organizationId,
        id: { in: buyers.map((buyer) => buyer.personId) },
      },
      select: { id: true },
    });
    if (people.length !== buyers.length) {
      throw new BadRequestException(
        'Um ou mais compradores são inválidos para esta organização',
      );
    }
    const primary = buyers.find((buyer) => buyer.isPrimary)!;
    if (primary.personId !== proposalPersonId) {
      throw new BadRequestException(
        'O cliente da proposta deve ser o comprador principal',
      );
    }
    for (const buyer of buyers) {
      await tx.personRole.upsert({
        where: {
          personId_role: {
            personId: buyer.personId,
            role: PersonRoleType.CLIENTE,
          },
        },
        update: {},
        create: {
          organizationId,
          personId: buyer.personId,
          role: PersonRoleType.CLIENTE,
        },
      });
    }
    return buyers.map((buyer) => ({
      personId: buyer.personId,
      participationPercentage: buyer.participationPercentage
        ? new Prisma.Decimal(buyer.participationPercentage)
        : null,
      isPrimary: buyer.isPrimary,
    }));
  }

  private async validateCommissionTenancy(
    tx: Prisma.TransactionClient,
    organizationId: string,
    commissions: CreateSaleCommissionDto[],
  ) {
    const personIds = commissions
      .map((commission) => commission.personId)
      .filter((id): id is string => Boolean(id));
    const userIds = commissions
      .map((commission) => commission.userId)
      .filter((id): id is string => Boolean(id));
    const [people, users] = await Promise.all([
      personIds.length
        ? tx.person.findMany({
            where: { organizationId, id: { in: personIds } },
            select: { id: true },
          })
        : [],
      userIds.length
        ? tx.user.findMany({
            where: { organizationId, id: { in: userIds } },
            select: { id: true },
          })
        : [],
    ]);
    if (
      people.length !== new Set(personIds).size ||
      users.length !== new Set(userIds).size
    ) {
      throw new BadRequestException(
        'Um ou mais beneficiários de comissão são inválidos',
      );
    }
    return commissions.map((commission) => ({
      personId: commission.personId ?? null,
      userId: commission.userId ?? null,
      percentage: commission.percentage
        ? new Prisma.Decimal(commission.percentage)
        : null,
      amount: new Prisma.Decimal(commission.amount),
      notes: commission.notes || null,
    }));
  }

  private validateReservation(
    reservation: LockedReservation,
    proposal: LockedProposal,
  ) {
    if (
      reservation.unitId !== proposal.unitId ||
      reservation.personId !== proposal.personId ||
      reservation.opportunityId !== proposal.opportunityId
    ) {
      throw new ConflictException('A reserva não corresponde à proposta');
    }
    if (
      reservation.status !== UnitReservationStatus.CONVERTIDA &&
      !(
        reservation.status === UnitReservationStatus.ATIVA &&
        reservation.expiresAt > new Date()
      )
    ) {
      throw new ConflictException(
        'A reserva não está válida para conversão em venda',
      );
    }
  }

  private assertPaymentPlan(
    finalPrice: Prisma.Decimal,
    conditions: { amount: Prisma.Decimal }[],
  ) {
    if (conditions.length === 0) {
      throw new ConflictException('A proposta não possui plano de pagamento');
    }
    const total = conditions.reduce(
      (sum, condition) => sum.plus(condition.amount),
      new Prisma.Decimal(0),
    );
    if (!total.equals(finalPrice)) {
      throw new ConflictException(
        'O plano de pagamento não corresponde ao valor da proposta',
      );
    }
  }

  private async ensureOpportunityWon(
    tx: Prisma.TransactionClient,
    proposal: LockedProposal,
    unit: LockedUnit,
    actor: SaleActor,
    entries: AuditEntry[],
  ) {
    const opportunity = await this.lockOpportunity(
      tx,
      proposal.opportunityId!,
      actor.organizationId,
    );
    if (
      opportunity.personId !== proposal.personId ||
      opportunity.developmentId !== unit.developmentId ||
      (opportunity.unitId && opportunity.unitId !== unit.id)
    ) {
      throw new ConflictException(
        'A oportunidade não corresponde à proposta e à unidade',
      );
    }
    const stage = await tx.salesStage.findUnique({
      where: { id: opportunity.stageId },
      select: { isWon: true, isLost: true },
    });
    if (stage?.isLost) {
      throw new ConflictException(
        'Uma oportunidade perdida não pode gerar venda',
      );
    }
    if (stage?.isWon) {
      if (!opportunity.unitId) {
        await tx.opportunity.update({
          where: { id: opportunity.id },
          data: { unitId: unit.id },
        });
      }
      return;
    }
    const wonStage = await tx.salesStage.findFirst({
      where: {
        organizationId: actor.organizationId,
        pipelineId: opportunity.pipelineId,
        isWon: true,
      },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!wonStage) {
      throw new ConflictException(
        'O pipeline não possui etapa de ganho configurada',
      );
    }
    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: { stageId: wonStage.id, unitId: unit.id, lostReason: null },
    });
    await tx.opportunityStageHistory.create({
      data: {
        organizationId: actor.organizationId,
        opportunityId: opportunity.id,
        fromStageId: opportunity.stageId,
        toStageId: wonStage.id,
        changedByUserId: actor.id,
      },
    });
    const metadata = {
      fromStageId: opportunity.stageId,
      toStageId: wonStage.id,
      proposalId: proposal.id,
    };
    entries.push(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
        entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
        entityId: opportunity.id,
        metadata,
      },
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.OPPORTUNITY_WON,
        entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
        entityId: opportunity.id,
        metadata,
      },
    );
  }

  private dateRange(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return undefined;
    const start = startDate
      ? new Date(`${startDate}T00:00:00.000Z`)
      : undefined;
    const endExclusive = endDate
      ? new Date(`${endDate}T00:00:00.000Z`)
      : undefined;
    endExclusive?.setUTCDate(endExclusive.getUTCDate() + 1);
    if (start && endExclusive && start >= endExclusive) {
      throw new BadRequestException(
        'startDate deve ser anterior ou igual a endDate',
      );
    }
    return {
      ...(start ? { gte: start } : {}),
      ...(endExclusive ? { lt: endExclusive } : {}),
    };
  }

  private generateSaleNumber() {
    return `VEN-${new Date().getUTCFullYear()}-${randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;
  }

  private async lockUnit(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [unit] = await tx.$queryRaw<LockedUnit[]>`
      SELECT "id", "developmentId", "status"
      FROM "Unit"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    return unit;
  }

  private async lockReservation(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [reservation] = await tx.$queryRaw<LockedReservation[]>`
      SELECT "id", "opportunityId", "personId", "unitId", "status", "expiresAt"
      FROM "UnitReservation"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!reservation) throw new NotFoundException('Reserva não encontrada');
    return reservation;
  }

  private async lockProposal(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [proposal] = await tx.$queryRaw<LockedProposal[]>`
      SELECT "id", "opportunityId", "reservationId", "personId", "unitId",
             "status", "currentVersionId", "convertedToSaleAt"
      FROM "SalesProposal"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!proposal) throw new NotFoundException('Proposta não encontrada');
    return proposal;
  }

  private async lockOpportunity(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [opportunity] = await tx.$queryRaw<LockedOpportunity[]>`
      SELECT "id", "pipelineId", "stageId", "personId", "developmentId", "unitId"
      FROM "Opportunity"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!opportunity) {
      throw new NotFoundException('Oportunidade não encontrada');
    }
    return opportunity;
  }

  private async lockSale(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [sale] = await tx.$queryRaw<LockedSale[]>`
      SELECT "id", "status"
      FROM "Sale"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!sale) throw new NotFoundException('Venda não encontrada');
    return sale;
  }
}
