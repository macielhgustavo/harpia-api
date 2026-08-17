import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UnitReservationStatus, UnitStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancelReservationDto } from './dto/cancel-reservation.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ListReservationsQueryDto } from './dto/list-reservations-query.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

interface LockedUnit {
  id: string;
  developmentId: string;
  status: UnitStatus;
}

interface LockedReservation {
  id: string;
  status: UnitReservationStatus;
  expiresAt: Date;
}

const RESERVATION_INCLUDE = {
  unit: {
    select: {
      id: true,
      identifier: true,
      status: true,
      development: { select: { id: true, name: true } },
    },
  },
  person: { select: { id: true, name: true, email: true, phone: true } },
  opportunity: {
    select: {
      id: true,
      source: true,
      stage: { select: { id: true, name: true } },
    },
  },
  createdByUser: { select: { id: true, name: true } },
  cancelledByUser: { select: { id: true, name: true } },
  convertedByUser: { select: { id: true, name: true } },
} satisfies Prisma.UnitReservationInclude;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: string, query: ListReservationsQueryDto) {
    await this.normalizeExpiredForOrganization(organizationId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.UnitReservationWhereInput = {
      organizationId,
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.personId ? { personId: query.personId } : {}),
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.developmentId
        ? { unit: { developmentId: query.developmentId } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.unitReservation.findMany({
        where,
        include: RESERVATION_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.unitReservation.count({ where }),
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
    const candidate = await this.prisma.unitReservation.findFirst({
      where: { id, organizationId },
      select: { unitId: true },
    });
    if (!candidate) throw new NotFoundException('Reserva não encontrada');
    await this.normalizeExpiredUnit(organizationId, candidate.unitId);

    const reservation = await this.prisma.unitReservation.findFirst({
      where: { id, organizationId },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) throw new NotFoundException('Reserva não encontrada');
    return reservation;
  }

  normalizeUnit(organizationId: string, unitId: string) {
    return this.normalizeExpiredUnit(organizationId, unitId);
  }

  async create(actor: MutationActor, dto: CreateReservationDto) {
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt <= new Date()) {
      throw new BadRequestException('A expiração deve estar no futuro');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const unit = await this.lockUnit(tx, dto.unitId, actor.organizationId);
        const currentStatus = await this.expireLockedUnit(
          tx,
          unit,
          actor.organizationId,
        );
        if (currentStatus !== UnitStatus.DISPONIVEL) {
          throw new ConflictException(
            'Somente unidades disponíveis podem ser reservadas',
          );
        }

        const person = await tx.person.findFirst({
          where: { id: dto.personId, organizationId: actor.organizationId },
          select: { id: true },
        });
        if (!person) {
          throw new BadRequestException(
            'Cliente inválido para esta organização',
          );
        }

        if (dto.opportunityId) {
          const opportunity = await tx.opportunity.findFirst({
            where: {
              id: dto.opportunityId,
              organizationId: actor.organizationId,
            },
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
              'Oportunidades concluídas não podem receber reservas',
            );
          }
          if (opportunity.personId !== dto.personId) {
            throw new BadRequestException(
              'A oportunidade pertence a outro cliente',
            );
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

        const reservation = await tx.unitReservation.create({
          data: {
            organizationId: actor.organizationId,
            unitId: unit.id,
            personId: dto.personId,
            opportunityId: dto.opportunityId,
            createdByUserId: actor.id,
            expiresAt,
            notes: dto.notes || undefined,
          },
          include: RESERVATION_INCLUDE,
        });
        await tx.unit.update({
          where: { id: unit.id },
          data: { status: UnitStatus.RESERVADA },
        });
        await this.audit.recordMany(
          [
            {
              organizationId: actor.organizationId,
              actorUserId: actor.id,
              action: AUDIT_ACTIONS.UNIT_RESERVED,
              entityType: AUDIT_ENTITY_TYPES.UNIT_RESERVATION,
              entityId: reservation.id,
              metadata: {
                unitId: unit.id,
                personId: dto.personId,
                opportunityId: dto.opportunityId ?? null,
                expiresAt: expiresAt.toISOString(),
              },
            },
            {
              organizationId: actor.organizationId,
              actorUserId: actor.id,
              action: AUDIT_ACTIONS.UPDATE,
              entityType: AUDIT_ENTITY_TYPES.UNIT,
              entityId: unit.id,
              metadata: {
                changedFields: ['status'],
                oldStatus: currentStatus,
                newStatus: UnitStatus.RESERVADA,
                reservationId: reservation.id,
              },
            },
          ],
          tx,
        );
        return reservation;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A unidade já possui uma reserva ativa');
      }
      throw error;
    }
  }

  async cancel(id: string, actor: MutationActor, dto: CancelReservationDto) {
    return this.transition(id, actor, async (tx, unit, reservation) => {
      const now = new Date();
      const cancelled = await tx.unitReservation.update({
        where: { id: reservation.id },
        data: {
          status: UnitReservationStatus.CANCELADA,
          cancelledAt: now,
          cancelledByUserId: actor.id,
          cancellationReason: dto.reason,
        },
        include: RESERVATION_INCLUDE,
      });
      if (unit.status === UnitStatus.RESERVADA) {
        await tx.unit.update({
          where: { id: unit.id },
          data: { status: UnitStatus.DISPONIVEL },
        });
      }
      await this.audit.recordMany(
        this.transitionAuditEntries(
          actor,
          reservation.id,
          unit,
          AUDIT_ACTIONS.UNIT_RESERVATION_CANCELLED,
          true,
        ),
        tx,
      );
      return cancelled;
    });
  }

  async convert(id: string, actor: MutationActor) {
    return this.transition(id, actor, async (tx, unit, reservation) => {
      const converted = await tx.unitReservation.update({
        where: { id: reservation.id },
        data: {
          status: UnitReservationStatus.CONVERTIDA,
          convertedAt: new Date(),
          convertedByUserId: actor.id,
        },
        include: RESERVATION_INCLUDE,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UNIT_RESERVATION_CONVERTED,
          entityType: AUDIT_ENTITY_TYPES.UNIT_RESERVATION,
          entityId: reservation.id,
          metadata: { unitId: unit.id },
        },
        tx,
      );
      return converted;
    });
  }

  private async transition<T>(
    id: string,
    actor: MutationActor,
    mutation: (
      tx: Prisma.TransactionClient,
      unit: LockedUnit,
      reservation: LockedReservation,
    ) => Promise<T>,
  ) {
    const candidate = await this.prisma.unitReservation.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: { unitId: true },
    });
    if (!candidate) throw new NotFoundException('Reserva não encontrada');

    return this.prisma.$transaction(async (tx) => {
      const unit = await this.lockUnit(
        tx,
        candidate.unitId,
        actor.organizationId,
      );
      await this.expireLockedUnit(tx, unit, actor.organizationId);
      const [reservation] = await tx.$queryRaw<LockedReservation[]>`
        SELECT "id", "status", "expiresAt"
        FROM "UnitReservation"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!reservation) throw new NotFoundException('Reserva não encontrada');
      if (reservation.status !== UnitReservationStatus.ATIVA) {
        throw new ConflictException('A reserva não está mais ativa');
      }
      return mutation(tx, unit, reservation);
    });
  }

  private async normalizeExpiredForOrganization(organizationId: string) {
    const candidates = await this.prisma.unitReservation.findMany({
      where: {
        organizationId,
        status: UnitReservationStatus.ATIVA,
        expiresAt: { lte: new Date() },
      },
      select: { unitId: true },
      distinct: ['unitId'],
    });
    for (const candidate of candidates) {
      await this.normalizeExpiredUnit(organizationId, candidate.unitId);
    }
  }

  private normalizeExpiredUnit(organizationId: string, unitId: string) {
    return this.prisma.$transaction(async (tx) => {
      const unit = await this.lockUnit(tx, unitId, organizationId);
      return this.expireLockedUnit(tx, unit, organizationId);
    });
  }

  private async expireLockedUnit(
    tx: Prisma.TransactionClient,
    unit: LockedUnit,
    organizationId: string,
  ) {
    const expired = await tx.unitReservation.findMany({
      where: {
        organizationId,
        unitId: unit.id,
        status: UnitReservationStatus.ATIVA,
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
    });
    if (expired.length === 0) return unit.status;

    await tx.unitReservation.updateMany({
      where: { id: { in: expired.map(({ id }) => id) } },
      data: { status: UnitReservationStatus.EXPIRADA },
    });
    let resultingStatus = unit.status;
    if (unit.status === UnitStatus.RESERVADA) {
      resultingStatus = UnitStatus.DISPONIVEL;
      await tx.unit.update({
        where: { id: unit.id },
        data: { status: resultingStatus },
      });
    }
    await this.audit.recordMany(
      [
        ...expired.map(({ id }) => ({
          organizationId,
          actorUserId: null,
          action: AUDIT_ACTIONS.UNIT_RESERVATION_EXPIRED,
          entityType: AUDIT_ENTITY_TYPES.UNIT_RESERVATION,
          entityId: id,
          metadata: { unitId: unit.id },
        })),
        ...(resultingStatus !== unit.status
          ? [
              {
                organizationId,
                actorUserId: null,
                action: AUDIT_ACTIONS.UPDATE,
                entityType: AUDIT_ENTITY_TYPES.UNIT,
                entityId: unit.id,
                metadata: {
                  changedFields: ['status'],
                  oldStatus: unit.status,
                  newStatus: resultingStatus,
                  expirationSource: 'UNIT_RESERVATION',
                },
              },
            ]
          : []),
      ],
      tx,
    );
    return resultingStatus;
  }

  private async lockUnit(
    tx: Prisma.TransactionClient,
    unitId: string,
    organizationId: string,
  ) {
    const [unit] = await tx.$queryRaw<LockedUnit[]>`
      SELECT "id", "developmentId", "status"
      FROM "Unit"
      WHERE "id" = ${unitId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    return unit;
  }

  private transitionAuditEntries(
    actor: MutationActor,
    reservationId: string,
    unit: LockedUnit,
    action: string,
    releasesUnit: boolean,
  ) {
    return [
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action,
        entityType: AUDIT_ENTITY_TYPES.UNIT_RESERVATION,
        entityId: reservationId,
        metadata: { unitId: unit.id },
      },
      ...(releasesUnit && unit.status === UnitStatus.RESERVADA
        ? [
            {
              organizationId: actor.organizationId,
              actorUserId: actor.id,
              action: AUDIT_ACTIONS.UPDATE,
              entityType: AUDIT_ENTITY_TYPES.UNIT,
              entityId: unit.id,
              metadata: {
                changedFields: ['status'],
                oldStatus: UnitStatus.RESERVADA,
                newStatus: UnitStatus.DISPONIVEL,
                reservationId,
              },
            },
          ]
        : []),
    ];
  }
}
