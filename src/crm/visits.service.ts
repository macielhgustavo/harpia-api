import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesVisitOutcome, SalesVisitStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalesVisitDto } from './dto/create-sales-visit.dto';
import { ListSalesVisitsQueryDto } from './dto/list-sales-visits-query.dto';
import { UpdateSalesVisitDto } from './dto/update-sales-visit.dto';

interface VisitActor {
  id: string;
  organizationId: string;
}

interface LockedVisit {
  id: string;
  assignedUserId: string | null;
  status: SalesVisitStatus;
  outcome: SalesVisitOutcome | null;
  cancellationReason: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

const VISIT_INCLUDE = {
  opportunity: { select: { id: true, stageId: true } },
  person: { select: { id: true, name: true, email: true, phone: true } },
  assignedUser: { select: { id: true, name: true, email: true } },
  createdByUser: { select: { id: true, name: true } },
  development: { select: { id: true, name: true } },
  unit: { select: { id: true, identifier: true, developmentId: true } },
} as const satisfies Prisma.SalesVisitInclude;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(organizationId: string, query: ListSalesVisitsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.SalesVisitWhereInput = {
      organizationId,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.scheduledFrom || query.scheduledTo
        ? {
            scheduledAt: {
              ...(query.scheduledFrom
                ? { gte: new Date(query.scheduledFrom) }
                : {}),
              ...(query.scheduledTo
                ? { lte: new Date(query.scheduledTo) }
                : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.salesVisit.findMany({
        where,
        include: VISIT_INCLUDE,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.salesVisit.count({ where }),
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

  async create(actor: VisitActor, dto: CreateSalesVisitDto) {
    return this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findFirst({
        where: { id: dto.opportunityId, organizationId: actor.organizationId },
        select: {
          id: true,
          personId: true,
          assignedUserId: true,
          developmentId: true,
          unitId: true,
        },
      });
      if (!opportunity) throw new BadRequestException('Oportunidade inválida');

      const assignedUserId = dto.assignedUserId ?? opportunity.assignedUserId;
      await this.assertAssignedUser(tx, assignedUserId, actor.organizationId);
      const location = await this.resolveLocation(
        tx,
        dto.developmentId ?? opportunity.developmentId,
        dto.unitId ?? opportunity.unitId,
        actor.organizationId,
      );
      const visit = await tx.salesVisit.create({
        data: {
          organizationId: actor.organizationId,
          opportunityId: opportunity.id,
          personId: opportunity.personId,
          assignedUserId,
          createdByUserId: actor.id,
          developmentId: location.developmentId,
          unitId: location.unitId,
          scheduledAt: new Date(dto.scheduledAt),
          durationMinutes: dto.durationMinutes ?? 60,
          location: dto.location || null,
          notes: dto.notes || null,
        },
        include: VISIT_INCLUDE,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.SALES_VISIT_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SALES_VISIT,
          entityId: visit.id,
          metadata: { opportunityId: opportunity.id },
        },
        tx,
      );
      return visit;
    });
  }

  async update(id: string, actor: VisitActor, dto: UpdateSalesVisitDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockVisit(tx, id, actor.organizationId);
      const assignedUserId =
        dto.assignedUserId === undefined
          ? current.assignedUserId
          : dto.assignedUserId;
      await this.assertAssignedUser(tx, assignedUserId, actor.organizationId);

      const status = dto.status ?? current.status;
      const outcome = dto.outcome === undefined ? current.outcome : dto.outcome;
      const cancellationReason =
        dto.cancellationReason === undefined
          ? current.cancellationReason
          : dto.cancellationReason;
      if (
        status === SalesVisitStatus.CANCELADA &&
        !cancellationReason?.trim()
      ) {
        throw new BadRequestException('Informe o motivo do cancelamento');
      }
      if (outcome && status !== SalesVisitStatus.REALIZADA) {
        throw new BadRequestException(
          'O resultado estruturado exige uma visita realizada',
        );
      }

      const isCompleted =
        status === SalesVisitStatus.REALIZADA ||
        status === SalesVisitStatus.NAO_COMPARECEU;
      const changedFields = Object.keys(dto).filter(
        (field) => dto[field as keyof UpdateSalesVisitDto] !== undefined,
      );
      const visit = await tx.salesVisit.update({
        where: { id },
        data: {
          assignedUserId,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
          durationMinutes: dto.durationMinutes,
          status,
          outcome: status === SalesVisitStatus.REALIZADA ? outcome : null,
          location: dto.location,
          result: dto.result,
          notes: dto.notes,
          completedAt: isCompleted ? (current.completedAt ?? new Date()) : null,
          cancelledAt:
            status === SalesVisitStatus.CANCELADA
              ? (current.cancelledAt ?? new Date())
              : null,
          cancellationReason:
            status === SalesVisitStatus.CANCELADA ? cancellationReason : null,
        },
        include: VISIT_INCLUDE,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.SALES_VISIT_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.SALES_VISIT,
          entityId: id,
          metadata: { changedFields, status },
        },
        tx,
      );
      return visit;
    });
  }

  private async lockVisit(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [visit] = await tx.$queryRaw<LockedVisit[]>`
      SELECT "id", "assignedUserId", "status", "outcome",
             "cancellationReason", "completedAt", "cancelledAt"
      FROM "SalesVisit"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!visit) throw new NotFoundException('Visita não encontrada');
    return visit;
  }

  private async assertAssignedUser(
    tx: Prisma.TransactionClient,
    userId: string | null | undefined,
    organizationId: string,
  ) {
    if (!userId) return;
    const user = await tx.user.findFirst({
      where: { id: userId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!user)
      throw new BadRequestException(
        'Responsável inválido para esta organização',
      );
  }

  private async resolveLocation(
    tx: Prisma.TransactionClient,
    developmentId: string | null | undefined,
    unitId: string | null | undefined,
    organizationId: string,
  ) {
    if (unitId) {
      const unit = await tx.unit.findFirst({
        where: { id: unitId, organizationId },
        select: { id: true, developmentId: true },
      });
      if (!unit) throw new BadRequestException('Unidade inválida');
      if (developmentId && developmentId !== unit.developmentId) {
        throw new BadRequestException(
          'A unidade não pertence ao empreendimento informado',
        );
      }
      return { developmentId: unit.developmentId, unitId: unit.id };
    }
    if (developmentId) {
      const development = await tx.development.findFirst({
        where: { id: developmentId, organizationId },
        select: { id: true },
      });
      if (!development)
        throw new BadRequestException('Empreendimento inválido');
    }
    return { developmentId: developmentId ?? null, unitId: null };
  }
}
