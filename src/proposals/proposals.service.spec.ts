/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ProposalPaymentConditionType,
  SalesProposalStatus,
  UnitStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { ProposalsService } from './proposals.service';

const actor = { id: 'user-1', organizationId: 'org-a' };
const future = () => new Date(Date.now() + 86_400_000).toISOString();

function transactionMock() {
  return {
    $queryRaw: jest.fn(),
    person: { findFirst: jest.fn() },
    opportunity: { findFirst: jest.fn(), update: jest.fn() },
    opportunityStageHistory: { create: jest.fn() },
    salesStage: { findUnique: jest.fn(), findFirst: jest.fn() },
    unit: { update: jest.fn() },
    unitPrice: { findFirst: jest.fn() },
    unitReservation: { create: jest.fn(), update: jest.fn() },
    salesProposal: { create: jest.fn(), update: jest.fn() },
    proposalVersion: { create: jest.fn(), findFirst: jest.fn() },
  };
}

function prismaMock(tx: ReturnType<typeof transactionMock>) {
  return {
    $transaction: jest.fn((callback: (database: typeof tx) => unknown) =>
      callback(tx),
    ),
    unit: { findFirst: jest.fn() },
    unitPrice: { findFirst: jest.fn() },
    salesProposal: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe('ProposalsService', () => {
  let tx: ReturnType<typeof transactionMock>;
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { record: jest.Mock; recordMany: jest.Mock };
  let reservations: { normalizeUnit: jest.Mock };
  let service: ProposalsService;

  beforeEach(() => {
    tx = transactionMock();
    prisma = prismaMock(tx);
    audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    reservations = { normalizeUnit: jest.fn().mockResolvedValue(undefined) };
    service = new ProposalsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      reservations as unknown as ReservationsService,
    );
  });

  it('returns the latest active-table price as a tenant-scoped snapshot preview', async () => {
    prisma.unit.findFirst.mockResolvedValue({
      id: 'unit-1',
      identifier: '101',
      developmentId: 'development-1',
    });
    prisma.unitPrice.findFirst.mockResolvedValue({
      id: 'price-1',
      value: 123456.78,
      priceTable: { id: 'table-1', name: 'Tabela agosto' },
    });

    await expect(service.pricePreview('org-a', 'unit-1')).resolves.toEqual({
      unit: {
        id: 'unit-1',
        identifier: '101',
        developmentId: 'development-1',
      },
      basePrice: '123456.78',
      priceTable: { id: 'table-1', name: 'Tabela agosto' },
    });
    expect(prisma.unitPrice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          unitId: 'unit-1',
        }),
      }),
    );
  });

  it('creates proposal, immutable version and conditions in one transaction', async () => {
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
      unitId: 'unit-1',
      stage: { isWon: false, isLost: false },
    });
    tx.unitPrice.findFirst.mockResolvedValue({
      value: 100000,
      priceTable: { id: 'table-1', name: 'Tabela agosto' },
    });
    tx.salesProposal.create.mockResolvedValue({ id: 'proposal-1' });
    tx.proposalVersion.create.mockResolvedValue({ id: 'version-1' });
    prisma.salesProposal.findFirst.mockResolvedValue({ id: 'proposal-1' });

    await service.create(actor, {
      personId: 'person-1',
      unitId: 'unit-1',
      opportunityId: 'opportunity-1',
      discount: '10000.00',
      validUntil: future(),
      conditions: [
        {
          type: ProposalPaymentConditionType.ENTRADA,
          amount: '10000.00',
        },
        {
          type: ProposalPaymentConditionType.PARCELAS,
          amount: '80000.00',
          installments: 20,
        },
      ],
    });

    const input = tx.proposalVersion.create.mock.calls[0][0];
    expect(input.data).toEqual(
      expect.objectContaining({
        version: 1,
        basePrice: expect.objectContaining({}),
        discount: expect.objectContaining({}),
        finalPrice: expect.objectContaining({}),
        downPayment: expect.objectContaining({}),
        sourcePriceTableId: 'table-1',
        sourcePriceTableName: 'Tabela agosto',
      }),
    );
    expect(input.data.basePrice.toFixed(2)).toBe('100000.00');
    expect(input.data.finalPrice.toFixed(2)).toBe('90000.00');
    expect(input.data.downPayment.toFixed(2)).toBe('10000.00');
    expect(tx.salesProposal.update).toHaveBeenCalledWith({
      where: { id: 'proposal-1' },
      data: { currentVersionId: 'version-1' },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ action: AUDIT_ACTIONS.PROPOSAL_CREATED }),
        expect.objectContaining({
          action: AUDIT_ACTIONS.PROPOSAL_VERSION_CREATED,
        }),
      ]),
      tx,
    );
  });

  it('rejects a payment plan whose sum differs from final price', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'unit-1',
        developmentId: 'development-1',
        status: UnitStatus.DISPONIVEL,
      },
    ]);
    tx.person.findFirst.mockResolvedValue({ id: 'person-1' });
    tx.unitPrice.findFirst.mockResolvedValue({
      value: 100000,
      priceTable: { id: 'table-1', name: 'Tabela agosto' },
    });

    await expect(
      service.create(actor, {
        personId: 'person-1',
        unitId: 'unit-1',
        discount: '10000.00',
        conditions: [
          {
            type: ProposalPaymentConditionType.OUTRO,
            amount: '89999.99',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.salesProposal.create).not.toHaveBeenCalled();
  });

  it('creates the next version from the original frozen base price', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'proposal-1',
        opportunityId: 'opportunity-1',
        reservationId: null,
        personId: 'person-1',
        unitId: 'unit-1',
        status: SalesProposalStatus.ENVIADA,
        currentVersionId: 'version-1',
        validUntil: null,
      },
    ]);
    tx.proposalVersion.findFirst.mockResolvedValue({
      id: 'version-1',
      version: 1,
      basePrice: 100000,
      sourcePriceTableId: 'table-old',
      sourcePriceTableName: 'Tabela congelada',
    });
    tx.proposalVersion.create.mockResolvedValue({ id: 'version-2' });
    prisma.salesProposal.findFirst.mockResolvedValue({ id: 'proposal-1' });

    await service.createVersion('proposal-1', actor, {
      discount: '20000.00',
      conditions: [
        {
          type: ProposalPaymentConditionType.SALDO_CHAVES,
          amount: '80000.00',
        },
      ],
    });

    const data = tx.proposalVersion.create.mock.calls[0][0].data;
    expect(data.version).toBe(2);
    expect(data.basePrice.toFixed(2)).toBe('100000.00');
    expect(data.sourcePriceTableId).toBe('table-old');
    expect(tx.salesProposal.update).toHaveBeenCalledWith({
      where: { id: 'proposal-1' },
      data: {
        currentVersionId: 'version-2',
        validUntil: null,
        status: SalesProposalStatus.EM_NEGOCIACAO,
      },
    });
  });

  it('accepts a sent proposal, reserves the unit and wins the opportunity without creating a sale', async () => {
    prisma.salesProposal.findFirst
      .mockResolvedValueOnce({ unitId: 'unit-1', reservationId: null })
      .mockResolvedValue({ id: 'proposal-1', status: 'ACEITA' });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'unit-1',
          developmentId: 'development-1',
          status: UnitStatus.DISPONIVEL,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'proposal-1',
          opportunityId: 'opportunity-1',
          reservationId: null,
          personId: 'person-1',
          unitId: 'unit-1',
          status: SalesProposalStatus.ENVIADA,
          currentVersionId: 'version-1',
          validUntil: new Date(Date.now() + 60_000),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'opportunity-1',
          pipelineId: 'pipeline-1',
          stageId: 'stage-current',
          personId: 'person-1',
          developmentId: 'development-1',
          unitId: 'unit-1',
        },
      ]);
    tx.salesStage.findUnique.mockResolvedValue({
      isWon: false,
      isLost: false,
    });
    tx.salesStage.findFirst.mockResolvedValue({ id: 'stage-won' });
    tx.unitReservation.create.mockResolvedValue({ id: 'reservation-handoff' });

    await service.accept('proposal-1', actor);

    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      data: { status: UnitStatus.RESERVADA },
    });
    expect(tx.unitReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-a',
          unitId: 'unit-1',
          personId: 'person-1',
          status: 'CONVERTIDA',
        }),
      }),
    );
    expect(tx.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'opportunity-1' },
        data: expect.objectContaining({
          stageId: 'stage-won',
          stageEnteredAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        opportunityId: 'opportunity-1',
        fromStageId: 'stage-current',
        toStageId: 'stage-won',
        changedByUserId: 'user-1',
      },
    });
    expect(tx.salesProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SalesProposalStatus.ACEITA }),
      }),
    );
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ action: AUDIT_ACTIONS.OPPORTUNITY_WON }),
        expect.objectContaining({ action: AUDIT_ACTIONS.PROPOSAL_ACCEPTED }),
      ]),
      tx,
    );
    expect((tx as Record<string, unknown>)['sale']).toBeUndefined();
  });

  it('does not restamp the stage of an opportunity already won', async () => {
    prisma.salesProposal.findFirst
      .mockResolvedValueOnce({ unitId: 'unit-1', reservationId: null })
      .mockResolvedValue({ id: 'proposal-1', status: 'ACEITA' });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'unit-1',
          developmentId: 'development-1',
          status: UnitStatus.DISPONIVEL,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'proposal-1',
          opportunityId: 'opportunity-1',
          reservationId: null,
          personId: 'person-1',
          unitId: 'unit-1',
          status: SalesProposalStatus.ENVIADA,
          currentVersionId: 'version-1',
          validUntil: new Date(Date.now() + 60_000),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'opportunity-1',
          pipelineId: 'pipeline-1',
          stageId: 'stage-won',
          personId: 'person-1',
          developmentId: 'development-1',
          unitId: 'unit-1',
        },
      ]);
    tx.salesStage.findUnique.mockResolvedValue({ isWon: true, isLost: false });
    tx.unitReservation.create.mockResolvedValue({ id: 'reservation-handoff' });

    await service.accept('proposal-1', actor);

    expect(tx.opportunity.update).not.toHaveBeenCalled();
    expect(tx.opportunityStageHistory.create).not.toHaveBeenCalled();
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.objectContaining({ action: AUDIT_ACTIONS.OPPORTUNITY_WON }),
      ]),
      tx,
    );
  });

  it('rejects direct acceptance when the unit is no longer available', async () => {
    prisma.salesProposal.findFirst.mockResolvedValue({
      unitId: 'unit-1',
      reservationId: null,
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'unit-1',
          developmentId: 'development-1',
          status: UnitStatus.VENDIDA,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'proposal-1',
          opportunityId: null,
          reservationId: null,
          personId: 'person-1',
          unitId: 'unit-1',
          status: SalesProposalStatus.ENVIADA,
          currentVersionId: 'version-1',
          validUntil: null,
        },
      ]);

    await expect(service.accept('proposal-1', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.salesProposal.update).not.toHaveBeenCalled();
  });
});
