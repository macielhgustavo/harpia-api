/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma,
  ProposalPaymentConditionType,
  SalesProposalStatus,
  SaleStatus,
  UnitReservationStatus,
  UnitStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { SalesService } from './sales.service';

const actor = { id: 'user-1', organizationId: 'org-a' };

function transactionMock() {
  return {
    $queryRaw: jest.fn(),
    person: { findMany: jest.fn() },
    personRole: { upsert: jest.fn() },
    user: { findMany: jest.fn() },
    proposalVersion: { findFirst: jest.fn() },
    development: { findFirst: jest.fn() },
    unitReservation: { update: jest.fn() },
    salesProposal: { update: jest.fn() },
    unit: { update: jest.fn() },
    sale: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    saleCommission: { create: jest.fn() },
    salesStage: { findUnique: jest.fn(), findFirst: jest.fn() },
    opportunity: { update: jest.fn() },
    opportunityStageHistory: { create: jest.fn() },
  };
}

function prismaMock(tx: ReturnType<typeof transactionMock>) {
  return {
    $transaction: jest.fn((callback: (database: typeof tx) => unknown) =>
      callback(tx),
    ),
    salesProposal: { findFirst: jest.fn() },
    sale: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    document: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function detailedSale() {
  return {
    id: 'sale-1',
    organizationId: 'org-a',
    developmentId: 'development-1',
    unitId: 'unit-1',
    proposalId: 'proposal-1',
    opportunityId: null,
    saleNumber: 'VEN-2026-0001',
    status: SaleStatus.ATIVA,
    saleDate: new Date('2026-08-25T00:00:00.000Z'),
    grossAmount: new Prisma.Decimal('500000.00'),
    discountAmount: new Prisma.Decimal('10000.00'),
    netAmount: new Prisma.Decimal('490000.00'),
    notes: null,
    createdByUserId: 'user-1',
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    development: { id: 'development-1', name: 'Jardins' },
    unit: {
      id: 'unit-1',
      identifier: '101',
      status: UnitStatus.VENDIDA,
      category: 'APARTAMENTO',
      grouping: 'Torre A',
    },
    opportunity: null,
    proposal: {
      id: 'proposal-1',
      status: SalesProposalStatus.ACEITA,
      currentVersionId: 'version-1',
      convertedToSaleAt: new Date(),
    },
    createdByUser: { id: 'user-1', name: 'Admin' },
    buyers: [
      {
        id: 'buyer-1',
        organizationId: 'org-a',
        saleId: 'sale-1',
        personId: 'person-1',
        participationPercentage: null,
        isPrimary: true,
        createdAt: new Date(),
        person: {
          id: 'person-1',
          name: 'Cliente',
          document: null,
          documentType: null,
          email: null,
          phone: null,
        },
      },
    ],
    paymentPlan: [],
    commissions: [],
    receivables: [],
  };
}

describe('SalesService', () => {
  let tx: ReturnType<typeof transactionMock>;
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { record: jest.Mock; recordMany: jest.Mock; findAll: jest.Mock };
  let receivables: { generateForSale: jest.Mock; findForSale: jest.Mock };
  let service: SalesService;

  beforeEach(() => {
    tx = transactionMock();
    prisma = prismaMock(tx);
    audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 5 }),
      findAll: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
    };
    receivables = {
      generateForSale: jest.fn().mockResolvedValue([]),
      findForSale: jest.fn().mockResolvedValue([]),
    };
    service = new SalesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      receivables as unknown as ReceivablesService,
    );
  });

  function arrangeConvertibleProposal() {
    prisma.salesProposal.findFirst.mockResolvedValue({
      unitId: 'unit-1',
      reservationId: 'reservation-1',
    });
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
          opportunityId: null,
          personId: 'person-1',
          unitId: 'unit-1',
          status: UnitReservationStatus.CONVERTIDA,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'proposal-1',
          opportunityId: null,
          reservationId: 'reservation-1',
          personId: 'person-1',
          unitId: 'unit-1',
          status: SalesProposalStatus.ACEITA,
          currentVersionId: 'version-1',
          convertedToSaleAt: null,
        },
      ]);
    tx.sale.findFirst.mockResolvedValue(null);
    tx.proposalVersion.findFirst.mockResolvedValue({
      id: 'version-1',
      basePrice: new Prisma.Decimal('500000'),
      discount: new Prisma.Decimal('10000'),
      finalPrice: new Prisma.Decimal('490000'),
      conditions: [
        {
          type: ProposalPaymentConditionType.ENTRADA,
          amount: new Prisma.Decimal('90000'),
          installments: null,
          firstDueDate: null,
          intervalMonths: null,
          description: 'Entrada',
          position: 0,
        },
        {
          type: ProposalPaymentConditionType.PARCELAS,
          amount: new Prisma.Decimal('400000'),
          installments: 40,
          firstDueDate: new Date('2026-09-01'),
          intervalMonths: 1,
          description: null,
          position: 1,
        },
      ],
    });
    tx.person.findMany.mockResolvedValue([
      { id: 'person-1' },
      { id: 'person-2' },
    ]);
    tx.user.findMany.mockResolvedValue([{ id: 'user-2' }]);
    tx.development.findFirst.mockResolvedValue({
      companyId: 'company-1',
      expectedDeliveryDate: new Date('2029-01-01T00:00:00.000Z'),
    });
    tx.sale.create.mockResolvedValue({
      id: 'sale-1',
      saleNumber: 'VEN-2026-0001',
      buyers: [
        { id: 'buyer-1', personId: 'person-1', isPrimary: true },
        { id: 'buyer-2', personId: 'person-2', isPrimary: false },
      ],
      commissions: [{ id: 'commission-1', personId: null, userId: 'user-2' }],
      paymentPlan: [
        {
          id: 'plan-1',
          type: ProposalPaymentConditionType.ENTRADA,
          amount: new Prisma.Decimal('90000'),
          installments: null,
          firstDueDate: null,
          intervalMonths: null,
          description: 'Entrada',
          position: 0,
        },
        {
          id: 'plan-2',
          type: ProposalPaymentConditionType.PARCELAS,
          amount: new Prisma.Decimal('400000'),
          installments: 40,
          firstDueDate: new Date('2026-09-01'),
          intervalMonths: 1,
          description: null,
          position: 1,
        },
      ],
    });
    prisma.sale.findFirst.mockResolvedValue(detailedSale());
  }

  /**
   * Same convertible proposal, but attached to an opportunity so the winning
   * path runs. The opportunity lock is the fourth raw query of the flow.
   */
  function arrangeProposalLinkedToOpportunity(
    stageId: string,
    currentStage: { isWon: boolean; isLost: boolean },
  ) {
    arrangeConvertibleProposal();
    tx.$queryRaw.mockReset();
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
          opportunityId: 'opportunity-1',
          personId: 'person-1',
          unitId: 'unit-1',
          status: UnitReservationStatus.CONVERTIDA,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'proposal-1',
          opportunityId: 'opportunity-1',
          reservationId: 'reservation-1',
          personId: 'person-1',
          unitId: 'unit-1',
          status: SalesProposalStatus.ACEITA,
          currentVersionId: 'version-1',
          convertedToSaleAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'opportunity-1',
          pipelineId: 'pipeline-1',
          stageId,
          personId: 'person-1',
          developmentId: 'development-1',
          unitId: null,
        },
      ]);
    tx.salesStage.findUnique.mockResolvedValue(currentStage);
    tx.salesStage.findFirst.mockResolvedValue({ id: 'stage-won' });
    tx.person.findMany.mockResolvedValue([{ id: 'person-1' }]);
  }

  it('converts the accepted proposal atomically and freezes its commercial terms', async () => {
    arrangeConvertibleProposal();

    await service.convertProposal('proposal-1', actor, {
      saleNumber: 'VEN-2026-0001',
      saleDate: '2026-08-25',
      buyers: [
        {
          personId: 'person-1',
          participationPercentage: '60',
          isPrimary: true,
        },
        {
          personId: 'person-2',
          participationPercentage: '40',
          isPrimary: false,
        },
      ],
      commissions: [{ userId: 'user-2', amount: '5000.00' }],
    });

    const create = tx.sale.create.mock.calls[0][0].data;
    expect(create.grossAmount.toFixed(2)).toBe('500000.00');
    expect(create.discountAmount.toFixed(2)).toBe('10000.00');
    expect(create.netAmount.toFixed(2)).toBe('490000.00');
    expect(create.buyers.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ personId: 'person-1', isPrimary: true }),
        expect.objectContaining({ personId: 'person-2', isPrimary: false }),
      ]),
    );
    expect(create.paymentPlan.create).toHaveLength(2);
    expect(tx.salesProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proposal-1' },
        data: expect.objectContaining({
          convertedToSaleAt: expect.any(Date),
          convertedToSaleByUserId: 'user-1',
        }),
      }),
    );
    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      data: { status: UnitStatus.VENDIDA },
    });
    expect(receivables.generateForSale).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sale-1',
        companyId: 'company-1',
        saleDate: new Date('2026-08-25'),
      }),
      expect.arrayContaining([expect.objectContaining({ id: 'plan-1' })]),
      'user-1',
      tx,
    );
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ action: AUDIT_ACTIONS.SALE_CREATED }),
        expect.objectContaining({ action: AUDIT_ACTIONS.SALE_BUYER_ADDED }),
        expect.objectContaining({
          action: AUDIT_ACTIONS.SALE_COMMISSION_CREATED,
        }),
        expect.objectContaining({
          action: AUDIT_ACTIONS.PROPOSAL_CONVERTED_TO_SALE,
        }),
      ]),
      tx,
    );
  });

  it('stamps the stage entry timestamp when the sale wins the opportunity', async () => {
    arrangeProposalLinkedToOpportunity('stage-negotiation', {
      isWon: false,
      isLost: false,
    });

    await service.convertProposal('proposal-1', actor, {
      buyers: [{ personId: 'person-1', isPrimary: true }],
    });

    expect(tx.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'opportunity-1' },
        data: expect.objectContaining({
          stageId: 'stage-won',
          stageEnteredAt: expect.any(Date),
          unitId: 'unit-1',
        }),
      }),
    );
    expect(tx.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        opportunityId: 'opportunity-1',
        fromStageId: 'stage-negotiation',
        toStageId: 'stage-won',
        changedByUserId: 'user-1',
      },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
        }),
        expect.objectContaining({ action: AUDIT_ACTIONS.OPPORTUNITY_WON }),
      ]),
      tx,
    );
  });

  it('does not restamp the stage of an opportunity already won', async () => {
    arrangeProposalLinkedToOpportunity('stage-won', {
      isWon: true,
      isLost: false,
    });

    await service.convertProposal('proposal-1', actor, {
      buyers: [{ personId: 'person-1', isPrimary: true }],
    });

    expect(tx.opportunityStageHistory.create).not.toHaveBeenCalled();
    expect(tx.opportunity.update).toHaveBeenCalledWith({
      where: { id: 'opportunity-1' },
      data: { unitId: 'unit-1' },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.objectContaining({ action: AUDIT_ACTIONS.OPPORTUNITY_WON }),
      ]),
      tx,
    );
  });

  it('keeps the opportunity lock scoped to the acting tenant', async () => {
    arrangeProposalLinkedToOpportunity('stage-negotiation', {
      isWon: false,
      isLost: false,
    });

    await service.convertProposal('proposal-1', actor, {
      buyers: [{ personId: 'person-1', isPrimary: true }],
    });

    const parameters = tx.$queryRaw.mock.calls[3].slice(1) as unknown[];
    expect(parameters).toEqual(['opportunity-1', 'org-a']);
  });

  it('returns the existing sale when the same conversion is retried', async () => {
    arrangeConvertibleProposal();
    tx.sale.findFirst.mockResolvedValueOnce({ id: 'sale-1' });

    await expect(
      service.convertProposal('proposal-1', actor, {
        buyers: [{ personId: 'person-1', isPrimary: true }],
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'sale-1' }));
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('fails the conversion when its audit cannot be persisted in the transaction', async () => {
    arrangeConvertibleProposal();
    tx.person.findMany.mockResolvedValue([{ id: 'person-1' }]);
    audit.recordMany.mockRejectedValueOnce(new Error('audit failed'));

    await expect(
      service.convertProposal('proposal-1', actor, {
        buyers: [{ personId: 'person-1', isPrimary: true }],
      }),
    ).rejects.toThrow('audit failed');
  });

  it('rejects duplicate buyers and incomplete participation before opening a transaction', async () => {
    await expect(
      service.convertProposal('proposal-1', actor, {
        buyers: [
          { personId: 'person-1', isPrimary: true },
          { personId: 'person-1', isPrimary: false },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.convertProposal('proposal-1', actor, {
        buyers: [
          {
            personId: 'person-1',
            participationPercentage: '50',
            isPrimary: true,
          },
          { personId: 'person-2', isPrimary: false },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a buyer from another tenant without creating a sale', async () => {
    arrangeConvertibleProposal();
    tx.person.findMany.mockResolvedValue([{ id: 'person-1' }]);

    await expect(
      service.convertProposal('proposal-1', actor, {
        buyers: [
          { personId: 'person-1', isPrimary: true },
          { personId: 'person-2', isPrimary: false },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('rejects conversion when the unit is no longer reserved', async () => {
    arrangeConvertibleProposal();
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'unit-1',
          developmentId: 'development-1',
          status: UnitStatus.VENDIDA,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'reservation-1',
          opportunityId: null,
          personId: 'person-1',
          unitId: 'unit-1',
          status: UnitReservationStatus.CONVERTIDA,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'proposal-1',
          opportunityId: null,
          reservationId: 'reservation-1',
          personId: 'person-1',
          unitId: 'unit-1',
          status: SalesProposalStatus.ACEITA,
          currentVersionId: 'version-1',
          convertedToSaleAt: null,
        },
      ]);

    await expect(
      service.convertProposal('proposal-1', actor, {
        buyers: [{ personId: 'person-1', isPrimary: true }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('lists only tenant-scoped sales and preserves the calendar range', async () => {
    prisma.sale.findMany.mockResolvedValue([detailedSale()]);
    prisma.sale.count.mockResolvedValue(1);

    const result = await service.findAll('org-a', {
      developmentId: 'development-1',
      buyerId: 'person-1',
      status: SaleStatus.ATIVA,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      page: 2,
      pageSize: 10,
    });

    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          developmentId: 'development-1',
          status: SaleStatus.ATIVA,
          buyers: { some: { personId: 'person-1' } },
          saleDate: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lt: new Date('2026-09-01T00:00:00.000Z'),
          },
        }),
        skip: 10,
        take: 10,
      }),
    );
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(result.data[0].outstandingBalance.toFixed(2)).toBe('490000.00');
  });

  it('loads detail documents and the latest sale audit safely inside the tenant', async () => {
    prisma.sale.findFirst.mockResolvedValue(detailedSale());
    prisma.document.findMany.mockResolvedValue([{ id: 'document-1' }]);
    audit.findAll.mockResolvedValue({ data: [{ id: 'audit-1' }] });

    const result = await service.findOne('sale-1', 'org-a');

    expect(prisma.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sale-1', organizationId: 'org-a' },
      }),
    );
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-a' }),
      }),
    );
    expect(audit.findAll).toHaveBeenCalledWith(
      'org-a',
      expect.objectContaining({ entityType: 'SALE', entityId: 'sale-1' }),
    );
    expect(result.documents).toEqual([{ id: 'document-1' }]);
    expect(result.audit).toEqual([{ id: 'audit-1' }]);
  });
});
