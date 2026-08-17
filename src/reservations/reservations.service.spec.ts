import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UnitReservationStatus, UnitStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from './reservations.service';

const actor = { id: 'user-1', organizationId: 'org-a' };

function transactionMock() {
  return {
    $queryRaw: jest.fn(),
    person: { findFirst: jest.fn() },
    opportunity: { findFirst: jest.fn() },
    unit: { update: jest.fn() },
    unitReservation: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function prismaMock(tx: ReturnType<typeof transactionMock>) {
  return {
    $transaction: jest.fn((callback: (database: typeof tx) => unknown) =>
      callback(tx),
    ),
    unitReservation: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe('ReservationsService', () => {
  let tx: ReturnType<typeof transactionMock>;
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { record: jest.Mock; recordMany: jest.Mock };
  let service: ReservationsService;

  beforeEach(() => {
    tx = transactionMock();
    prisma = prismaMock(tx);
    audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    service = new ReservationsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('reserves an available unit atomically with tenant validation and audit', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'unit-1',
        developmentId: 'development-1',
        status: UnitStatus.DISPONIVEL,
      },
    ]);
    tx.person.findFirst.mockResolvedValue({ id: 'person-1' });
    tx.opportunity.findFirst.mockResolvedValue({
      personId: 'person-1',
      developmentId: 'development-1',
      unitId: null,
      stage: { isWon: false, isLost: false },
    });
    tx.unitReservation.create.mockResolvedValue({ id: 'reservation-1' });
    tx.unit.update.mockResolvedValue({ id: 'unit-1' });

    await service.create(actor, {
      unitId: 'unit-1',
      personId: 'person-1',
      opportunityId: 'opportunity-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      notes: 'Visita agendada',
    });

    const [createInput] = tx.unitReservation.create.mock
      .calls[0] as unknown as [
      {
        data: {
          organizationId: string;
          unitId: string;
          personId: string;
          opportunityId: string;
          createdByUserId: string;
        };
      },
    ];
    expect(createInput.data).toEqual(
      expect.objectContaining({
        organizationId: 'org-a',
        unitId: 'unit-1',
        personId: 'person-1',
        opportunityId: 'opportunity-1',
        createdByUserId: 'user-1',
      }),
    );
    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      data: { status: UnitStatus.RESERVADA },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: AUDIT_ACTIONS.UNIT_RESERVED,
          entityType: AUDIT_ENTITY_TYPES.UNIT_RESERVATION,
          entityId: 'reservation-1',
        }),
      ]),
      tx,
    );
  });

  it('rejects direct reservation when the unit is not available', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'unit-1',
        developmentId: 'development-1',
        status: UnitStatus.BLOQUEADA,
      },
    ]);

    await expect(
      service.create(actor, {
        unitId: 'unit-1',
        personId: 'person-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.unitReservation.create).not.toHaveBeenCalled();
  });

  it('rejects a past expiration before opening a transaction', async () => {
    await expect(
      service.create(actor, {
        unitId: 'unit-1',
        personId: 'person-1',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed for a cross-tenant unit', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.create(actor, {
        unitId: 'unit-other-org',
        personId: 'person-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.person.findFirst).not.toHaveBeenCalled();
  });

  it('maps the partial unique index race to a public conflict', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'unit-1',
        developmentId: 'development-1',
        status: UnitStatus.DISPONIVEL,
      },
    ]);
    tx.person.findFirst.mockResolvedValue({ id: 'person-1' });
    tx.unitReservation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await expect(
      service.create(actor, {
        unitId: 'unit-1',
        personId: 'person-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels an active reservation and releases the unit', async () => {
    prisma.unitReservation.findFirst.mockResolvedValue({ unitId: 'unit-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'unit-1',
          developmentId: 'development-1',
          status: UnitStatus.RESERVADA,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'reservation-1',
          status: UnitReservationStatus.ATIVA,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]);
    tx.unitReservation.update.mockResolvedValue({
      id: 'reservation-1',
      status: UnitReservationStatus.CANCELADA,
    });

    await service.cancel('reservation-1', actor, {
      reason: 'Cliente desistiu',
    });

    const [cancelInput] = tx.unitReservation.update.mock
      .calls[0] as unknown as [
      {
        data: {
          status: UnitReservationStatus;
          cancelledByUserId: string;
          cancellationReason: string;
        };
      },
    ];
    expect(cancelInput.data).toEqual(
      expect.objectContaining({
        status: UnitReservationStatus.CANCELADA,
        cancelledByUserId: 'user-1',
        cancellationReason: 'Cliente desistiu',
      }),
    );
    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      data: { status: UnitStatus.DISPONIVEL },
    });
  });

  it('converts an active reservation while retaining the reserved unit handoff', async () => {
    prisma.unitReservation.findFirst.mockResolvedValue({ unitId: 'unit-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'unit-1',
          developmentId: 'development-1',
          status: UnitStatus.RESERVADA,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'reservation-1',
          status: UnitReservationStatus.ATIVA,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]);
    tx.unitReservation.update.mockResolvedValue({
      id: 'reservation-1',
      status: UnitReservationStatus.CONVERTIDA,
    });

    await service.convert('reservation-1', actor);

    const [convertInput] = tx.unitReservation.update.mock
      .calls[0] as unknown as [
      {
        data: {
          status: UnitReservationStatus;
          convertedByUserId: string;
        };
      },
    ];
    expect(convertInput.data).toEqual(
      expect.objectContaining({
        status: UnitReservationStatus.CONVERTIDA,
        convertedByUserId: 'user-1',
      }),
    );
    expect(tx.unit.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.UNIT_RESERVATION_CONVERTED,
      }),
      tx,
    );
  });

  it('normalizes an expired reservation and releases its unit on read', async () => {
    prisma.unitReservation.findFirst
      .mockResolvedValueOnce({ unitId: 'unit-1' })
      .mockResolvedValueOnce({
        id: 'reservation-1',
        status: UnitReservationStatus.EXPIRADA,
      });
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'unit-1',
        developmentId: 'development-1',
        status: UnitStatus.RESERVADA,
      },
    ]);
    tx.unitReservation.findMany.mockResolvedValue([{ id: 'reservation-1' }]);

    const result = await service.findOne('reservation-1', 'org-a');

    expect(tx.unitReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['reservation-1'] } },
      data: { status: UnitReservationStatus.EXPIRADA },
    });
    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      data: { status: UnitStatus.DISPONIVEL },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: null,
          action: AUDIT_ACTIONS.UNIT_RESERVATION_EXPIRED,
        }),
      ]),
      tx,
    );
    expect(result.status).toBe(UnitReservationStatus.EXPIRADA);
  });
});
