/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, PropertyInterestPurpose } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertOpportunityPropertyInterestDto } from './dto/upsert-opportunity-property-interest.dto';
import { OpportunityPropertyInterestsService } from './opportunity-property-interests.service';

const actor = { id: 'user-a', organizationId: 'org-a' };

function setup() {
  const existing = {
    id: 'interest-1',
    organizationId: actor.organizationId,
    opportunityId: 'opportunity-1',
    developmentId: 'development-1',
    unitTypeId: 'type-1',
    minBedrooms: 2,
    maxBedrooms: 3,
    minArea: 70,
    maxArea: 90,
    minPrice: new Prisma.Decimal('300000.00'),
    maxPrice: new Prisma.Decimal('500000.00'),
    availableDownPayment: new Prisma.Decimal('80000.00'),
    purpose: PropertyInterestPurpose.MORADIA,
    notes: 'Perto do metrô',
    development: { id: 'development-1', name: 'Aurora' },
    unitType: {
      id: 'type-1',
      name: 'Apartamento',
      developmentId: 'development-1',
    },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'opportunity-1' }]),
    development: {
      findFirst: jest.fn().mockResolvedValue({ id: 'development-1' }),
    },
    unitType: { findFirst: jest.fn().mockResolvedValue({ id: 'type-1' }) },
    opportunityPropertyInterest: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(existing),
      delete: jest.fn().mockResolvedValue(existing),
    },
  };
  const prisma = {
    opportunity: {
      findFirst: jest.fn().mockResolvedValue({ id: 'opportunity-1' }),
    },
    opportunityPropertyInterest: {
      findFirst: jest.fn().mockResolvedValue(existing),
    },
    $transaction: jest.fn((callback: (database: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const service = new OpportunityPropertyInterestsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, audit, existing };
}

const profile = (): UpsertOpportunityPropertyInterestDto => ({
  developmentId: 'development-1',
  unitTypeId: 'type-1',
  minBedrooms: 2,
  maxBedrooms: 3,
  minArea: 70,
  maxArea: 90,
  minPrice: '300000.00',
  maxPrice: '500000.00',
  availableDownPayment: '80000.00',
  purpose: PropertyInterestPurpose.MORADIA,
  notes: ' Perto do metrô ',
});

describe('OpportunityPropertyInterestsService', () => {
  it('reads a profile scoped by opportunity and organization', async () => {
    const { service, prisma, existing } = setup();
    await expect(service.findOne('opportunity-1', 'org-a')).resolves.toEqual(
      existing,
    );
    expect(prisma.opportunity.findFirst).toHaveBeenCalledWith({
      where: { id: 'opportunity-1', organizationId: 'org-a' },
      select: { id: true },
    });
    expect(prisma.opportunityPropertyInterest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { opportunityId: 'opportunity-1', organizationId: 'org-a' },
      }),
    );
  });

  it('returns null for an opportunity without profile', async () => {
    const { service, prisma } = setup();
    prisma.opportunityPropertyInterest.findFirst.mockResolvedValue(null);
    await expect(service.findOne('opportunity-1', 'org-a')).resolves.toBeNull();
  });

  it('hides an opportunity from another tenant during read', async () => {
    const { service, prisma } = setup();
    prisma.opportunity.findFirst.mockResolvedValue(null);
    await expect(
      service.findOne('opportunity-1', 'org-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.opportunityPropertyInterest.findFirst).not.toHaveBeenCalled();
  });

  it('creates one profile even when the opportunity has no unit', async () => {
    const { service, tx, audit, existing } = setup();
    await expect(
      service.upsert('opportunity-1', actor, profile()),
    ).resolves.toEqual(existing);
    expect(tx.opportunityPropertyInterest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { opportunityId: 'opportunity-1' },
        create: expect.objectContaining({
          organizationId: 'org-a',
          opportunityId: 'opportunity-1',
          notes: 'Perto do metrô',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_CREATED,
        entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY_PROPERTY_INTEREST,
        entityId: 'interest-1',
      }),
      tx,
    );
  });

  it('updates the same profile id and replaces omitted fields with null', async () => {
    const { service, tx, audit, existing } = setup();
    tx.opportunityPropertyInterest.findFirst.mockResolvedValue(existing);
    await service.upsert('opportunity-1', actor, {
      purpose: PropertyInterestPurpose.INVESTIMENTO,
    });
    expect(tx.opportunityPropertyInterest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { opportunityId: 'opportunity-1' },
        update: expect.objectContaining({
          developmentId: null,
          unitTypeId: null,
          minPrice: null,
          purpose: PropertyInterestPurpose.INVESTIMENTO,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_UPDATED,
        metadata: expect.objectContaining({
          changedFields: expect.arrayContaining(['developmentId', 'purpose']),
        }),
      }),
      tx,
    );
  });

  it('does not update or audit an identical PUT', async () => {
    const { service, tx, audit, existing } = setup();
    tx.opportunityPropertyInterest.findFirst.mockResolvedValue(existing);
    await expect(
      service.upsert('opportunity-1', actor, profile()),
    ).resolves.toBe(existing);
    expect(tx.opportunityPropertyInterest.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('uses Prisma Decimal without passing money through Number', async () => {
    const { service, tx } = setup();
    await service.upsert('opportunity-1', actor, {
      maxPrice: '500000.17',
      availableDownPayment: '80000.09',
    });
    const call = tx.opportunityPropertyInterest.upsert.mock.calls[0][0] as {
      create: {
        maxPrice: Prisma.Decimal;
        availableDownPayment: Prisma.Decimal;
      };
    };
    expect(call.create.maxPrice).toBeInstanceOf(Prisma.Decimal);
    expect(call.create.maxPrice.toFixed(2)).toBe('500000.17');
    expect(call.create.availableDownPayment.toFixed(2)).toBe('80000.09');
  });

  it('allows all optional preferences to be omitted', async () => {
    const { service, tx } = setup();
    await service.upsert('opportunity-1', actor, {});
    expect(tx.development.findFirst).not.toHaveBeenCalled();
    expect(tx.unitType.findFirst).not.toHaveBeenCalled();
    expect(tx.opportunityPropertyInterest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          developmentId: null,
          unitTypeId: null,
          minBedrooms: null,
          maxPrice: null,
        }),
      }),
    );
  });

  it('allows development without unit type', async () => {
    const { service, tx } = setup();
    await service.upsert('opportunity-1', actor, {
      developmentId: 'development-1',
    });
    expect(tx.development.findFirst).toHaveBeenCalledWith({
      where: { id: 'development-1', organizationId: 'org-a' },
      select: { id: true },
    });
    expect(tx.unitType.findFirst).not.toHaveBeenCalled();
  });

  it('validates the unit type within the selected development and tenant', async () => {
    const { service, tx } = setup();
    await service.upsert('opportunity-1', actor, profile());
    expect(tx.unitType.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'type-1',
        organizationId: 'org-a',
        developmentId: 'development-1',
      },
      select: { id: true },
    });
  });

  it('rejects an invalid or cross-tenant development', async () => {
    const { service, tx, audit } = setup();
    tx.development.findFirst.mockResolvedValue(null);
    await expect(
      service.upsert('opportunity-1', actor, { developmentId: 'org-b-dev' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.opportunityPropertyInterest.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a type from another development or tenant', async () => {
    const { service, tx } = setup();
    tx.unitType.findFirst.mockResolvedValue(null);
    await expect(
      service.upsert('opportunity-1', actor, profile()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.opportunityPropertyInterest.upsert).not.toHaveBeenCalled();
  });

  it('rejects a type without a development', async () => {
    const { service, tx } = setup();
    await expect(
      service.upsert('opportunity-1', actor, { unitTypeId: 'type-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.unitType.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    [{ minPrice: '500001.00', maxPrice: '500000.00' }, 'price'],
    [{ minArea: 91, maxArea: 90 }, 'area'],
    [{ minBedrooms: 4, maxBedrooms: 3 }, 'bedrooms'],
    [{ minBedrooms: 1.5 }, 'fractional bedrooms'],
    [{ minBedrooms: -1 }, 'negative bedrooms'],
    [{ minArea: -1 }, 'negative area'],
    [{ maxPrice: '-1.00' }, 'negative price'],
    [{ availableDownPayment: '-0.01' }, 'negative down payment'],
  ] as const)('rejects invalid %s range/value (%s)', async (dto) => {
    const { service, prisma, tx } = setup();
    await expect(
      service.upsert(
        'opportunity-1',
        actor,
        dto as UpsertOpportunityPropertyInterestDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.opportunityPropertyInterest.upsert).not.toHaveBeenCalled();
  });

  it('hides a cross-tenant opportunity on PUT before any write', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.upsert('opportunity-b', actor, profile()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.opportunityPropertyInterest.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('removes a profile and audits only scoped metadata', async () => {
    const { service, tx, audit, existing } = setup();
    tx.opportunityPropertyInterest.findFirst.mockResolvedValue(existing);
    await expect(service.remove('opportunity-1', actor)).resolves.toEqual(
      existing,
    );
    expect(tx.opportunityPropertyInterest.delete).toHaveBeenCalledWith({
      where: { id: 'interest-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        actorUserId: 'user-a',
        action: AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_DELETED,
        entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY_PROPERTY_INTEREST,
        entityId: 'interest-1',
        metadata: {
          opportunityId: 'opportunity-1',
          developmentId: 'development-1',
          unitTypeId: 'type-1',
          purpose: PropertyInterestPurpose.MORADIA,
        },
      },
      tx,
    );
  });

  it('returns 404 when removing an absent profile', async () => {
    const { service, tx, audit } = setup();
    await expect(service.remove('opportunity-1', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.opportunityPropertyInterest.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('locks the opportunity before reading or writing its profile', async () => {
    const { service, tx } = setup();
    await service.upsert('opportunity-1', actor, profile());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.opportunityPropertyInterest.findFirst.mock.invocationCallOrder[0],
    );
    expect(
      tx.opportunityPropertyInterest.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.opportunityPropertyInterest.upsert.mock.invocationCallOrder[0],
    );
  });
});
