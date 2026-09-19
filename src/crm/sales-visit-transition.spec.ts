import { BadRequestException, ConflictException } from '@nestjs/common';
import { SalesVisitOutcome, SalesVisitStatus } from '@prisma/client';
import { UpdateSalesVisitDto } from './dto/update-sales-visit.dto';
import {
  LockedSalesVisit,
  planSalesVisitUpdate,
} from './sales-visit-transition';

const now = new Date('2026-09-18T12:00:00.000Z');
const scheduledAt = new Date('2026-09-19T12:00:00.000Z');

function visit(
  status: SalesVisitStatus = SalesVisitStatus.AGENDADA,
): LockedSalesVisit {
  return {
    id: 'visit-1',
    assignedUserId: 'user-1',
    scheduledAt,
    durationMinutes: 60,
    status,
    outcome: null,
    location: 'Sala 1',
    result: null,
    notes: null,
    cancellationReason: null,
    completedAt: null,
    cancelledAt: null,
  };
}

const plan = (dto: UpdateSalesVisitDto, current = visit()) =>
  planSalesVisitUpdate(current, dto, now);

describe('SalesVisit transition plan', () => {
  it.each([
    SalesVisitStatus.REALIZADA,
    SalesVisitStatus.NAO_COMPARECEU,
    SalesVisitStatus.CANCELADA,
  ])('allows AGENDADA -> %s with coherent timestamps', (status) => {
    const transition = plan({
      status,
      ...(status === SalesVisitStatus.CANCELADA
        ? { cancellationReason: ' Cliente desistiu ' }
        : {}),
    });
    expect(transition?.data.status).toBe(status);
    expect(transition?.data.completedAt).toEqual(
      status === SalesVisitStatus.CANCELADA ? null : now,
    );
    expect(transition?.data.cancelledAt).toEqual(
      status === SalesVisitStatus.CANCELADA ? now : null,
    );
    expect(transition?.data.cancellationReason).toBe(
      status === SalesVisitStatus.CANCELADA ? 'Cliente desistiu' : null,
    );
  });

  it.each([
    SalesVisitStatus.REALIZADA,
    SalesVisitStatus.NAO_COMPARECEU,
    SalesVisitStatus.CANCELADA,
  ])(
    'rejects any edit after %s, including correction and reactivation',
    (status) => {
      for (const dto of [
        {},
        { status: SalesVisitStatus.AGENDADA },
        { status: SalesVisitStatus.REALIZADA },
        { status: SalesVisitStatus.NAO_COMPARECEU },
        { status: SalesVisitStatus.CANCELADA, cancellationReason: 'Outro' },
        { scheduledAt: '2026-09-20T12:00:00.000Z' },
        { result: 'Teste' },
      ]) {
        expect(() => plan(dto, visit(status))).toThrow(ConflictException);
      }
    },
  );

  it('permits scheduling edits only while AGENDADA and detects no-op', () => {
    expect(plan({})).toBeNull();
    expect(plan({ status: SalesVisitStatus.AGENDADA })).toBeNull();
    expect(
      plan({
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes: 60,
        location: ' Sala 1 ',
      }),
    ).toBeNull();
    expect(plan({ durationMinutes: 90 })?.data).toEqual({
      durationMinutes: 90,
    });
  });

  it('rejects null for non-nullable scheduling fields', () => {
    expect(() => plan({ scheduledAt: null as unknown as string })).toThrow(
      BadRequestException,
    );
    expect(() => plan({ durationMinutes: null as unknown as number })).toThrow(
      BadRequestException,
    );
  });

  it('rejects result and outcome before completion', () => {
    for (const dto of [
      { outcome: SalesVisitOutcome.INTERESSE_ALTO },
      { result: 'Interessado' },
      { cancellationReason: 'Motivo' },
    ]) {
      expect(() => plan(dto)).toThrow(BadRequestException);
    }
  });

  it('accepts outcome and result only on REALIZADA', () => {
    const transition = plan({
      status: SalesVisitStatus.REALIZADA,
      outcome: SalesVisitOutcome.INTERESSE_ALTO,
      result: ' Gostou da unidade ',
      notes: ' Enviar proposta ',
    });
    expect(transition?.data).toEqual({
      status: SalesVisitStatus.REALIZADA,
      outcome: SalesVisitOutcome.INTERESSE_ALTO,
      result: 'Gostou da unidade',
      notes: 'Enviar proposta',
      completedAt: now,
      cancelledAt: null,
      cancellationReason: null,
    });
  });

  it.each([SalesVisitStatus.CANCELADA, SalesVisitStatus.NAO_COMPARECEU])(
    'rejects outcome and result on %s',
    (status) => {
      for (const field of [
        { outcome: SalesVisitOutcome.INTERESSE_ALTO },
        { result: 'Não deveria persistir' },
      ]) {
        expect(() =>
          plan({
            status,
            ...(status === SalesVisitStatus.CANCELADA
              ? { cancellationReason: 'Desistiu' }
              : {}),
            ...field,
          }),
        ).toThrow(BadRequestException);
      }
    },
  );

  it('requires a non-blank cancellation reason', () => {
    for (const cancellationReason of [undefined, '', '   ']) {
      expect(() =>
        plan({ status: SalesVisitStatus.CANCELADA, cancellationReason }),
      ).toThrow(BadRequestException);
    }
  });

  it('rejects scheduling fields bundled with finalization', () => {
    for (const dto of [
      {
        status: SalesVisitStatus.REALIZADA,
        scheduledAt: '2026-09-20T12:00:00.000Z',
      },
      {
        status: SalesVisitStatus.CANCELADA,
        cancellationReason: 'Desistiu',
        durationMinutes: 90,
      },
      { status: SalesVisitStatus.NAO_COMPARECEU, location: 'Sala 2' },
    ]) {
      expect(() => plan(dto)).toThrow(BadRequestException);
    }
  });

  it('rejects cancellation reason on completed/no-show and notes on cancellation', () => {
    expect(() =>
      plan({ status: SalesVisitStatus.REALIZADA, cancellationReason: 'x' }),
    ).toThrow(BadRequestException);
    expect(() =>
      plan({
        status: SalesVisitStatus.NAO_COMPARECEU,
        cancellationReason: 'x',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      plan({
        status: SalesVisitStatus.CANCELADA,
        cancellationReason: 'x',
        notes: 'x',
      }),
    ).toThrow(BadRequestException);
  });
});
