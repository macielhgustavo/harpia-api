/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompanyType } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from './companies.service';

describe('CompaniesService audit', () => {
  const actor = { id: 'user-1', organizationId: 'org-a' };
  let transaction: ReturnType<typeof createTransactionMock>;
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock };
  let service: CompaniesService;

  beforeEach(() => {
    transaction = createTransactionMock();
    prisma = createPrismaMock(transaction);
    audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    service = new CompaniesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('creates the company and its audit log in the same transaction', async () => {
    transaction.company.create.mockResolvedValue({ id: 'company-1' });

    await service.create(actor, {
      name: 'SPE Norte',
      cnpj: '12345678000190',
      type: CompanyType.SPE,
      notes: 'private business note',
    });

    expect(transaction.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-a' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.COMPANY,
        entityId: 'company-1',
      },
      transaction,
    );
  });

  it('allowlists update metadata instead of recording field values', async () => {
    prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    transaction.company.update.mockResolvedValue({ id: 'company-1' });

    await service.update('company-1', actor, {
      name: 'SPE Sul',
      notes: 'must not appear in audit metadata',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        entityId: 'company-1',
        metadata: { changedFields: ['name', 'notes'] },
      }),
      transaction,
    );
  });

  it('locks the tenant company before dependency checks, delete and audit', async () => {
    transaction.company.delete.mockResolvedValue({ id: 'company-1' });

    await service.remove('company-1', actor);

    expect(transaction.$queryRaw).toHaveBeenCalledWith(
      expect.any(Array),
      'company-1',
      'org-a',
    );
    expect(transaction.development.count).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.DELETE,
        entityId: 'company-1',
      }),
      transaction,
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.development.count.mock.invocationCallOrder[0],
    );
    expect(
      transaction.development.count.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.company.delete.mock.invocationCallOrder[0]);
    expect(transaction.company.delete.mock.invocationCallOrder[0]).toBeLessThan(
      audit.record.mock.invocationCallOrder[0],
    );
  });

  it('rejects a company outside the actor tenant before checking dependencies', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.remove('company-from-org-b', actor)).rejects.toThrow(
      NotFoundException,
    );

    expect(transaction.$queryRaw).toHaveBeenCalledWith(
      expect.any(Array),
      'company-from-org-b',
      'org-a',
    );
    expect(transaction.development.count).not.toHaveBeenCalled();
    expect(transaction.company.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('keeps the company and audit untouched when developments exist', async () => {
    transaction.development.count.mockResolvedValueOnce(1);

    await expect(service.remove('company-1', actor)).rejects.toThrow(
      ConflictException,
    );

    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.development.count.mock.invocationCallOrder[0],
    );
    expect(transaction.company.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not mutate or audit an entity outside the actor tenant', async () => {
    prisma.company.findFirst.mockResolvedValue(null);

    await expect(
      service.update('company-from-org-b', actor, { name: 'Blocked' }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

function createTransactionMock() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'company-1' }]),
    company: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    development: { count: jest.fn().mockResolvedValue(0) },
  };
}

function createPrismaMock(
  transaction: ReturnType<typeof createTransactionMock>,
) {
  return {
    company: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
}
