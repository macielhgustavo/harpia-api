import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProposalPaymentConditionType,
  SalesProposalStatus,
  UnitReservationStatus,
  UnitStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditEntry, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { CreateProposalVersionDto } from './dto/create-proposal-version.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';
import { ProposalPaymentConditionDto } from './dto/proposal-payment-condition.dto';
import { RejectProposalDto } from './dto/reject-proposal.dto';

interface ProposalActor {
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
  validUntil: Date | null;
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

const PROPOSAL_INCLUDE = {
  person: { select: { id: true, name: true, email: true, phone: true } },
  unit: {
    select: {
      id: true,
      identifier: true,
      status: true,
      development: { select: { id: true, name: true } },
    },
  },
  opportunity: {
    select: {
      id: true,
      stage: { select: { id: true, name: true, code: true } },
    },
  },
  reservation: { select: { id: true, status: true, expiresAt: true } },
  createdByUser: { select: { id: true, name: true } },
  sentByUser: { select: { id: true, name: true } },
  acceptedByUser: { select: { id: true, name: true } },
  rejectedByUser: { select: { id: true, name: true } },
  currentVersion: {
    include: {
      conditions: { orderBy: { position: 'asc' as const } },
      createdByUser: { select: { id: true, name: true } },
    },
  },
  versions: {
    include: {
      conditions: { orderBy: { position: 'asc' as const } },
      createdByUser: { select: { id: true, name: true } },
    },
    orderBy: { version: 'desc' as const },
  },
} satisfies Prisma.SalesProposalInclude;

const EDITABLE_STATUSES = new Set<SalesProposalStatus>([
  SalesProposalStatus.RASCUNHO,
  SalesProposalStatus.ENVIADA,
  SalesProposalStatus.EM_NEGOCIACAO,
]);

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reservations: ReservationsService,
  ) {}

  async pricePreview(organizationId: string, unitId: string) {
    if (!unitId?.trim()) {
      throw new BadRequestException('unitId é obrigatório');
    }
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, organizationId },
      select: { id: true, identifier: true, developmentId: true },
    });
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    const price = await this.findActivePrice(
      this.prisma,
      organizationId,
      unitId,
    );
    return {
      unit,
      basePrice: this.money(price.value).toFixed(2),
      priceTable: { id: price.priceTable.id, name: price.priceTable.name },
    };
  }

  async findAll(organizationId: string, query: ListProposalsQueryDto) {
    await this.normalizeExpired(organizationId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.SalesProposalWhereInput = {
      organizationId,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.reservationId ? { reservationId: query.reservationId } : {}),
      ...(query.personId ? { personId: query.personId } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.developmentId
        ? { unit: { developmentId: query.developmentId } }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.salesProposal.findMany({
        where,
        include: PROPOSAL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.salesProposal.count({ where }),
    ]);
    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string, organizationId: string) {
    await this.normalizeExpired(organizationId, id);
    const proposal = await this.prisma.salesProposal.findFirst({
      where: { id, organizationId },
      include: PROPOSAL_INCLUDE,
    });
    if (!proposal) throw new NotFoundException('Proposta não encontrada');
    return proposal;
  }

  async create(actor: ProposalActor, dto: CreateProposalDto) {
    const validUntil = this.futureDateOrNull(dto.validUntil);
    if (dto.reservationId) {
      await this.reservations.normalizeUnit(actor.organizationId, dto.unitId);
    }

    const proposalId = await this.prisma.$transaction(async (tx) => {
      const unit = await this.lockUnit(tx, dto.unitId, actor.organizationId);
      const reservation = dto.reservationId
        ? await this.lockReservation(
            tx,
            dto.reservationId,
            actor.organizationId,
          )
        : null;
      this.validateReservation(reservation, dto, unit);
      if (!reservation && unit.status !== UnitStatus.DISPONIVEL) {
        throw new ConflictException(
          'Somente unidades disponíveis ou reservadas para este cliente podem receber propostas',
        );
      }

      const person = await tx.person.findFirst({
        where: { id: dto.personId, organizationId: actor.organizationId },
        select: { id: true },
      });
      if (!person) {
        throw new BadRequestException('Cliente inválido para esta organização');
      }
      if (dto.opportunityId) {
        await this.validateOpportunity(
          tx,
          dto.opportunityId,
          actor.organizationId,
          dto.personId,
          unit,
        );
      }

      const price = await this.findActivePrice(
        tx,
        actor.organizationId,
        unit.id,
      );
      const pricing = this.validatePricing(
        price.value,
        dto.discount,
        dto.conditions,
      );
      const proposal = await tx.salesProposal.create({
        data: {
          organizationId: actor.organizationId,
          opportunityId: dto.opportunityId,
          reservationId: dto.reservationId,
          personId: dto.personId,
          unitId: unit.id,
          validUntil,
          createdByUserId: actor.id,
        },
        select: { id: true },
      });
      const version = await tx.proposalVersion.create({
        data: {
          organizationId: actor.organizationId,
          proposalId: proposal.id,
          version: 1,
          basePrice: pricing.basePrice,
          discount: pricing.discount,
          finalPrice: pricing.finalPrice,
          downPayment: pricing.downPayment,
          validUntil,
          notes: dto.notes || null,
          sourcePriceTableId: price.priceTable.id,
          sourcePriceTableName: price.priceTable.name,
          createdByUserId: actor.id,
          conditions: {
            create: this.conditionCreateData(
              actor.organizationId,
              dto.conditions,
              pricing.amounts,
            ),
          },
        },
        select: { id: true },
      });
      await tx.salesProposal.update({
        where: { id: proposal.id },
        data: { currentVersionId: version.id },
      });
      await this.audit.recordMany(
        [
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.PROPOSAL_CREATED,
            entityType: AUDIT_ENTITY_TYPES.SALES_PROPOSAL,
            entityId: proposal.id,
            metadata: {
              unitId: unit.id,
              personId: dto.personId,
              opportunityId: dto.opportunityId ?? null,
              reservationId: dto.reservationId ?? null,
            },
          },
          this.versionAudit(actor, proposal.id, version.id, 1),
        ],
        tx,
      );
      return proposal.id;
    });
    return this.findOne(proposalId, actor.organizationId);
  }

  async createVersion(
    id: string,
    actor: ProposalActor,
    dto: CreateProposalVersionDto,
  ) {
    const validUntil = this.futureDateOrNull(dto.validUntil);
    const proposalId = await this.prisma.$transaction(async (tx) => {
      const proposal = await this.lockProposal(tx, id, actor.organizationId);
      if (!EDITABLE_STATUSES.has(proposal.status)) {
        throw new ConflictException('Esta proposta não aceita novas versões');
      }
      if (!proposal.currentVersionId) {
        throw new ConflictException('A proposta não possui versão atual');
      }
      const current = await tx.proposalVersion.findFirst({
        where: {
          id: proposal.currentVersionId,
          proposalId: proposal.id,
          organizationId: actor.organizationId,
        },
      });
      if (!current) {
        throw new ConflictException('A versão atual da proposta não existe');
      }
      const pricing = this.validatePricing(
        current.basePrice,
        dto.discount,
        dto.conditions,
      );
      const versionNumber = current.version + 1;
      const version = await tx.proposalVersion.create({
        data: {
          organizationId: actor.organizationId,
          proposalId: proposal.id,
          version: versionNumber,
          basePrice: pricing.basePrice,
          discount: pricing.discount,
          finalPrice: pricing.finalPrice,
          downPayment: pricing.downPayment,
          validUntil,
          notes: dto.notes || null,
          sourcePriceTableId: current.sourcePriceTableId,
          sourcePriceTableName: current.sourcePriceTableName,
          createdByUserId: actor.id,
          conditions: {
            create: this.conditionCreateData(
              actor.organizationId,
              dto.conditions,
              pricing.amounts,
            ),
          },
        },
        select: { id: true },
      });
      await tx.salesProposal.update({
        where: { id: proposal.id },
        data: {
          currentVersionId: version.id,
          validUntil,
          status:
            proposal.status === SalesProposalStatus.RASCUNHO
              ? SalesProposalStatus.RASCUNHO
              : SalesProposalStatus.EM_NEGOCIACAO,
        },
      });
      await this.audit.record(
        this.versionAudit(actor, proposal.id, version.id, versionNumber),
        tx,
      );
      return proposal.id;
    });
    return this.findOne(proposalId, actor.organizationId);
  }

  async send(id: string, actor: ProposalActor) {
    await this.normalizeExpired(actor.organizationId, id);
    await this.prisma.$transaction(async (tx) => {
      const proposal = await this.lockProposal(tx, id, actor.organizationId);
      if (
        proposal.status !== SalesProposalStatus.RASCUNHO &&
        proposal.status !== SalesProposalStatus.EM_NEGOCIACAO
      ) {
        throw new ConflictException('Esta proposta não pode ser enviada');
      }
      this.assertCurrentAndValid(proposal);
      await tx.salesProposal.update({
        where: { id },
        data: {
          status: SalesProposalStatus.ENVIADA,
          sentAt: new Date(),
          sentByUserId: actor.id,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PROPOSAL_SENT,
          entityType: AUDIT_ENTITY_TYPES.SALES_PROPOSAL,
          entityId: id,
        },
        tx,
      );
    });
    return this.findOne(id, actor.organizationId);
  }

  async reject(id: string, actor: ProposalActor, dto: RejectProposalDto) {
    await this.normalizeExpired(actor.organizationId, id);
    await this.prisma.$transaction(async (tx) => {
      const proposal = await this.lockProposal(tx, id, actor.organizationId);
      if (
        proposal.status !== SalesProposalStatus.ENVIADA &&
        proposal.status !== SalesProposalStatus.EM_NEGOCIACAO
      ) {
        throw new ConflictException('Esta proposta não pode ser recusada');
      }
      await tx.salesProposal.update({
        where: { id },
        data: {
          status: SalesProposalStatus.RECUSADA,
          rejectedAt: new Date(),
          rejectedByUserId: actor.id,
          rejectionReason: dto.reason,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PROPOSAL_REJECTED,
          entityType: AUDIT_ENTITY_TYPES.SALES_PROPOSAL,
          entityId: id,
          metadata: { reasonProvided: true },
        },
        tx,
      );
    });
    return this.findOne(id, actor.organizationId);
  }

  async accept(id: string, actor: ProposalActor) {
    const candidate = await this.prisma.salesProposal.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: { unitId: true, reservationId: true },
    });
    if (!candidate) throw new NotFoundException('Proposta não encontrada');
    if (candidate.reservationId) {
      await this.reservations.normalizeUnit(
        actor.organizationId,
        candidate.unitId,
      );
    }

    await this.prisma.$transaction(async (tx) => {
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
      const proposal = await this.lockProposal(tx, id, actor.organizationId);
      if (
        proposal.status !== SalesProposalStatus.ENVIADA &&
        proposal.status !== SalesProposalStatus.EM_NEGOCIACAO
      ) {
        throw new ConflictException('Esta proposta não pode ser aceita');
      }
      this.assertCurrentAndValid(proposal);

      if (reservation) {
        this.validateReservationForProposal(reservation, proposal, unit);
      } else if (unit.status !== UnitStatus.DISPONIVEL) {
        throw new ConflictException(
          'A unidade não está disponível para esta proposta',
        );
      }

      const auditEntries: AuditEntry[] = [];
      let effectiveReservationId = reservation?.id ?? null;
      if (!reservation) {
        const transitionTime = new Date();
        const handoffReservation = await tx.unitReservation.create({
          data: {
            organizationId: actor.organizationId,
            unitId: unit.id,
            personId: proposal.personId,
            opportunityId: proposal.opportunityId,
            createdByUserId: actor.id,
            expiresAt: new Date(transitionTime.getTime() + 24 * 60 * 60 * 1000),
            status: UnitReservationStatus.CONVERTIDA,
            convertedAt: transitionTime,
            convertedByUserId: actor.id,
            notes: 'Transição criada automaticamente pelo aceite da proposta',
          },
          select: { id: true },
        });
        effectiveReservationId = handoffReservation.id;
        await tx.unit.update({
          where: { id: unit.id },
          data: { status: UnitStatus.RESERVADA },
        });
        auditEntries.push({
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.UNIT,
          entityId: unit.id,
          metadata: {
            changedFields: ['status'],
            oldStatus: unit.status,
            newStatus: UnitStatus.RESERVADA,
            proposalId: proposal.id,
          },
        });
        auditEntries.push({
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UNIT_RESERVATION_CONVERTED,
          entityType: AUDIT_ENTITY_TYPES.UNIT_RESERVATION,
          entityId: handoffReservation.id,
          metadata: {
            unitId: unit.id,
            proposalId: proposal.id,
            createdFromProposal: true,
          },
        });
      } else {
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
        await this.winOpportunity(
          tx,
          proposal.opportunityId,
          actor,
          proposal,
          auditEntries,
        );
      }

      await tx.salesProposal.update({
        where: { id: proposal.id },
        data: {
          status: SalesProposalStatus.ACEITA,
          reservationId: effectiveReservationId,
          acceptedAt: new Date(),
          acceptedByUserId: actor.id,
        },
      });
      auditEntries.push({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.PROPOSAL_ACCEPTED,
        entityType: AUDIT_ENTITY_TYPES.SALES_PROPOSAL,
        entityId: proposal.id,
        metadata: {
          unitId: unit.id,
          reservationId: effectiveReservationId,
          opportunityId: proposal.opportunityId,
        },
      });
      await this.audit.recordMany(auditEntries, tx);
    });
    return this.findOne(id, actor.organizationId);
  }

  private async winOpportunity(
    tx: Prisma.TransactionClient,
    opportunityId: string,
    actor: ProposalActor,
    proposal: LockedProposal,
    entries: AuditEntry[],
  ) {
    const opportunity = await this.lockOpportunity(
      tx,
      opportunityId,
      actor.organizationId,
    );
    if (
      opportunity.personId !== proposal.personId ||
      (opportunity.unitId && opportunity.unitId !== proposal.unitId)
    ) {
      throw new ConflictException(
        'A oportunidade não corresponde à proposta aceita',
      );
    }
    const currentStage = await tx.salesStage.findUnique({
      where: { id: opportunity.stageId },
      select: { isWon: true, isLost: true },
    });
    if (currentStage?.isLost) {
      throw new ConflictException(
        'Uma oportunidade perdida não pode aceitar proposta',
      );
    }
    if (currentStage?.isWon) return;

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
      data: {
        stageId: wonStage.id,
        unitId: opportunity.unitId ?? proposal.unitId,
        lostReason: null,
      },
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

  private async normalizeExpired(organizationId: string, id?: string) {
    const candidates = await this.prisma.salesProposal.findMany({
      where: {
        organizationId,
        ...(id ? { id } : {}),
        status: {
          in: [SalesProposalStatus.ENVIADA, SalesProposalStatus.EM_NEGOCIACAO],
        },
        validUntil: { lt: new Date() },
      },
      select: { id: true },
    });
    for (const candidate of candidates) {
      await this.prisma.$transaction(async (tx) => {
        const proposal = await this.lockProposal(
          tx,
          candidate.id,
          organizationId,
        );
        if (
          (proposal.status === SalesProposalStatus.ENVIADA ||
            proposal.status === SalesProposalStatus.EM_NEGOCIACAO) &&
          proposal.validUntil &&
          proposal.validUntil < new Date()
        ) {
          await tx.salesProposal.update({
            where: { id: proposal.id },
            data: { status: SalesProposalStatus.EXPIRADA },
          });
          await this.audit.record(
            {
              organizationId,
              actorUserId: null,
              action: AUDIT_ACTIONS.PROPOSAL_EXPIRED,
              entityType: AUDIT_ENTITY_TYPES.SALES_PROPOSAL,
              entityId: proposal.id,
            },
            tx,
          );
        }
      });
    }
  }

  private async validateOpportunity(
    tx: Prisma.TransactionClient,
    opportunityId: string,
    organizationId: string,
    personId: string,
    unit: LockedUnit,
  ) {
    const opportunity = await tx.opportunity.findFirst({
      where: { id: opportunityId, organizationId },
      select: {
        personId: true,
        developmentId: true,
        unitId: true,
        stage: { select: { isWon: true, isLost: true } },
      },
    });
    if (!opportunity) {
      throw new BadRequestException(
        'Oportunidade inválida para esta organização',
      );
    }
    if (opportunity.stage.isWon || opportunity.stage.isLost) {
      throw new ConflictException(
        'Oportunidades concluídas não podem receber propostas',
      );
    }
    if (opportunity.personId !== personId) {
      throw new BadRequestException('A oportunidade pertence a outro cliente');
    }
    if (
      (opportunity.developmentId &&
        opportunity.developmentId !== unit.developmentId) ||
      (opportunity.unitId && opportunity.unitId !== unit.id)
    ) {
      throw new BadRequestException(
        'A unidade não corresponde à oportunidade informada',
      );
    }
  }

  private validateReservation(
    reservation: LockedReservation | null,
    dto: CreateProposalDto,
    unit: LockedUnit,
  ) {
    if (!reservation) return;
    if (
      reservation.status !== UnitReservationStatus.ATIVA ||
      reservation.expiresAt <= new Date()
    ) {
      throw new ConflictException('A reserva não está mais ativa');
    }
    if (
      reservation.unitId !== unit.id ||
      reservation.personId !== dto.personId ||
      reservation.opportunityId !== (dto.opportunityId ?? null)
    ) {
      throw new BadRequestException(
        'A reserva não corresponde ao cliente, unidade e oportunidade informados',
      );
    }
    if (unit.status !== UnitStatus.RESERVADA) {
      throw new ConflictException('A unidade não está reservada');
    }
  }

  private validateReservationForProposal(
    reservation: LockedReservation,
    proposal: LockedProposal,
    unit: LockedUnit,
  ) {
    if (
      reservation.status !== UnitReservationStatus.ATIVA ||
      reservation.expiresAt <= new Date()
    ) {
      throw new ConflictException('A reserva não está mais ativa');
    }
    if (
      reservation.unitId !== proposal.unitId ||
      reservation.personId !== proposal.personId ||
      reservation.opportunityId !== proposal.opportunityId
    ) {
      throw new ConflictException('A reserva não corresponde à proposta');
    }
    if (unit.status !== UnitStatus.RESERVADA) {
      throw new ConflictException('A unidade não está reservada');
    }
  }

  private validatePricing(
    baseValue: Prisma.Decimal | number,
    discountValue: string,
    conditions: ProposalPaymentConditionDto[],
  ) {
    const basePrice = this.money(baseValue);
    const discount = this.money(discountValue);
    if (basePrice.isNegative() || discount.isNegative()) {
      throw new BadRequestException('Os valores não podem ser negativos');
    }
    if (discount.greaterThan(basePrice)) {
      throw new BadRequestException('O desconto não pode superar o preço base');
    }
    const finalPrice = basePrice.minus(discount);
    const amounts = conditions.map((condition) => this.money(condition.amount));
    if (amounts.some((amount) => amount.isNegative())) {
      throw new BadRequestException(
        'As condições de pagamento não podem ser negativas',
      );
    }
    const total = amounts.reduce(
      (sum, amount) => sum.plus(amount),
      new Prisma.Decimal(0),
    );
    if (!total.equals(finalPrice)) {
      throw new BadRequestException(
        'A soma das condições de pagamento deve ser igual ao valor final',
      );
    }
    const downPayment = conditions.reduce(
      (sum, condition, index) =>
        condition.type === ProposalPaymentConditionType.ENTRADA
          ? sum.plus(amounts[index])
          : sum,
      new Prisma.Decimal(0),
    );
    return { basePrice, discount, finalPrice, downPayment, amounts };
  }

  private conditionCreateData(
    organizationId: string,
    conditions: ProposalPaymentConditionDto[],
    amounts: Prisma.Decimal[],
  ) {
    return conditions.map((condition, position) => ({
      organizationId,
      type: condition.type,
      amount: amounts[position],
      installments: condition.installments,
      firstDueDate: condition.firstDueDate
        ? new Date(condition.firstDueDate)
        : null,
      intervalMonths: condition.intervalMonths,
      description: condition.description || null,
      position,
    }));
  }

  private async findActivePrice(
    database: PrismaService | Prisma.TransactionClient,
    organizationId: string,
    unitId: string,
  ) {
    const price = await database.unitPrice.findFirst({
      where: {
        organizationId,
        unitId,
        priceTable: { active: true },
      },
      include: { priceTable: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    if (!price) {
      throw new BadRequestException('Unidade não possui preço em tabela ativa');
    }
    return price;
  }

  private money(value: Prisma.Decimal | number | string) {
    try {
      const decimal = new Prisma.Decimal(value).toDecimalPlaces(2);
      if (!decimal.isFinite()) throw new Error('invalid decimal');
      return decimal;
    } catch {
      throw new BadRequestException('Valor monetário inválido');
    }
  }

  private futureDateOrNull(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    if (date <= new Date()) {
      throw new BadRequestException('A validade deve estar no futuro');
    }
    return date;
  }

  private assertCurrentAndValid(proposal: LockedProposal) {
    if (!proposal.currentVersionId) {
      throw new ConflictException('A proposta não possui versão atual');
    }
    if (proposal.validUntil && proposal.validUntil <= new Date()) {
      throw new ConflictException('A proposta está expirada');
    }
  }

  private versionAudit(
    actor: ProposalActor,
    proposalId: string,
    versionId: string,
    version: number,
  ): AuditEntry {
    return {
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: AUDIT_ACTIONS.PROPOSAL_VERSION_CREATED,
      entityType: AUDIT_ENTITY_TYPES.PROPOSAL_VERSION,
      entityId: versionId,
      metadata: { proposalId, version },
    };
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
             "status", "currentVersionId", "validUntil"
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
}
