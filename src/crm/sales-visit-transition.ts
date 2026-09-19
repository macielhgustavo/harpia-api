import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, SalesVisitOutcome, SalesVisitStatus } from '@prisma/client';
import { UpdateSalesVisitDto } from './dto/update-sales-visit.dto';

export interface LockedSalesVisit {
  id: string;
  assignedUserId: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  status: SalesVisitStatus;
  outcome: SalesVisitOutcome | null;
  location: string | null;
  result: string | null;
  notes: string | null;
  cancellationReason: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export interface SalesVisitUpdatePlan {
  data: Prisma.SalesVisitUncheckedUpdateInput;
  changedFields: string[];
}

const has = (value: unknown) => value !== undefined;
const textOrNull = (value: string | null) =>
  typeof value === 'string' ? value.trim() || null : null;
const statusLabel: Record<SalesVisitStatus, string> = {
  AGENDADA: 'agendada',
  REALIZADA: 'realizada',
  CANCELADA: 'cancelada',
  NAO_COMPARECEU: 'com não comparecimento',
};

/** The locked database row, not the client's stale copy, is authoritative. */
export function planSalesVisitUpdate(
  current: LockedSalesVisit,
  dto: UpdateSalesVisitDto,
  now = new Date(),
): SalesVisitUpdatePlan | null {
  if (current.status !== SalesVisitStatus.AGENDADA) {
    throw new ConflictException(
      `Visita ${statusLabel[current.status]} não pode ser alterada. Atualize a lista de visitas.`,
    );
  }

  const status = dto.status ?? SalesVisitStatus.AGENDADA;
  const data: Prisma.SalesVisitUncheckedUpdateInput = {};
  const changedFields: string[] = [];

  if (status === SalesVisitStatus.AGENDADA) {
    if (has(dto.outcome) || has(dto.result) || has(dto.cancellationReason)) {
      throw new BadRequestException(
        'Visita agendada não aceita resultado ou motivo de cancelamento',
      );
    }
    if (
      has(dto.assignedUserId) &&
      dto.assignedUserId !== current.assignedUserId
    ) {
      data.assignedUserId = dto.assignedUserId;
      changedFields.push('assignedUserId');
    }
    if (has(dto.scheduledAt)) {
      if (dto.scheduledAt === null) {
        throw new BadRequestException('Data da visita inválida');
      }
      const scheduledAt = new Date(dto.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new BadRequestException('Data da visita inválida');
      }
      if (scheduledAt.getTime() !== current.scheduledAt.getTime()) {
        data.scheduledAt = scheduledAt;
        changedFields.push('scheduledAt');
      }
    }
    if (
      has(dto.durationMinutes) &&
      dto.durationMinutes !== current.durationMinutes
    ) {
      if (dto.durationMinutes === null) {
        throw new BadRequestException('Duração da visita inválida');
      }
      data.durationMinutes = dto.durationMinutes;
      changedFields.push('durationMinutes');
    }
    if (has(dto.location)) {
      const location = textOrNull(dto.location);
      if (location !== current.location) {
        data.location = location;
        changedFields.push('location');
      }
    }
    if (has(dto.notes)) {
      const notes = textOrNull(dto.notes);
      if (notes !== current.notes) {
        data.notes = notes;
        changedFields.push('notes');
      }
    }
    return changedFields.length ? { data, changedFields } : null;
  }

  if (
    has(dto.scheduledAt) ||
    has(dto.durationMinutes) ||
    has(dto.assignedUserId) ||
    has(dto.location)
  ) {
    throw new BadRequestException(
      'Altere o agendamento antes de registrar o estado final da visita',
    );
  }

  if (status === SalesVisitStatus.REALIZADA) {
    if (has(dto.cancellationReason)) {
      throw new BadRequestException(
        'Visita realizada não aceita motivo de cancelamento',
      );
    }
    if (
      dto.outcome &&
      !Object.values(SalesVisitOutcome).includes(dto.outcome)
    ) {
      throw new BadRequestException('Resultado da visita inválido');
    }
    data.status = status;
    data.outcome = dto.outcome ?? null;
    data.result = has(dto.result) ? textOrNull(dto.result) : null;
    data.completedAt = now;
    data.cancelledAt = null;
    data.cancellationReason = null;
    changedFields.push('status');
    if (has(dto.outcome)) changedFields.push('outcome');
    if (has(dto.result)) changedFields.push('result');
    if (has(dto.notes)) {
      data.notes = textOrNull(dto.notes);
      changedFields.push('notes');
    }
    return { data, changedFields };
  }

  if (status === SalesVisitStatus.NAO_COMPARECEU) {
    if (
      has(dto.outcome) ||
      has(dto.result) ||
      has(dto.cancellationReason) ||
      has(dto.notes)
    ) {
      throw new BadRequestException(
        'Não comparecimento não aceita resultado ou motivo de cancelamento',
      );
    }
    return {
      data: {
        status,
        outcome: null,
        result: null,
        completedAt: now,
        cancelledAt: null,
        cancellationReason: null,
      },
      changedFields: ['status'],
    };
  }

  if (status === SalesVisitStatus.CANCELADA) {
    if (has(dto.outcome) || has(dto.result) || has(dto.notes)) {
      throw new BadRequestException(
        'Visita cancelada não aceita resultado comercial',
      );
    }
    const cancellationReason = textOrNull(dto.cancellationReason ?? null);
    if (!cancellationReason) {
      throw new BadRequestException('Informe o motivo do cancelamento');
    }
    return {
      data: {
        status,
        outcome: null,
        result: null,
        completedAt: null,
        cancelledAt: now,
        cancellationReason,
      },
      changedFields: ['status', 'cancellationReason'],
    };
  }

  throw new BadRequestException('Status da visita inválido');
}
