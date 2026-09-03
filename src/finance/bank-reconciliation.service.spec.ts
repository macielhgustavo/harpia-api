import { BadRequestException } from '@nestjs/common';
import {
  BankReconciliationStatus,
  BankStatementEntryType,
  FinancialTransactionType,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BankReconciliationService } from './bank-reconciliation.service';

describe('BankReconciliationService', () => {
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: BankReconciliationService;

  beforeEach(() => {
    prisma = {
      bankAccount: { findFirst: jest.fn() },
      bankStatementEntry: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      financialTransaction: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue({}) };
    service = new BankReconciliationService(
      prisma as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('imports an idempotent batch and reports duplicate rows', async () => {
    prisma.bankAccount.findFirst.mockResolvedValue({ id: 'account-1' });
    const tx = {
      bankStatementEntry: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: any) => unknown) =>
      work(tx),
    );

    const result = await service.import(
      { id: 'user-1', organizationId: 'organization-1' },
      {
        bankAccountId: 'account-1',
        entries: [
          {
            externalId: 'bank-1',
            date: '2026-09-02',
            description: 'Recebimento de cliente',
            type: BankStatementEntryType.CREDITO,
            amount: '1500.00',
          },
          {
            externalId: 'bank-1',
            date: '2026-09-02',
            description: 'Recebimento de cliente',
            type: BankStatementEntryType.CREDITO,
            amount: '1500.00',
          },
        ],
      },
    );

    expect(result).toEqual({ received: 2, imported: 1, skipped: 1 });
    const rows = tx.bankStatementEntry.createMany.mock.calls[0][0].data;
    expect(rows[0].fingerprint).toHaveLength(64);
    expect(rows[0].fingerprint).toBe(rows[1].fingerprint);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'organization-1',
        metadata: expect.objectContaining({ imported: 1, skipped: 1 }),
      }),
      tx,
    );
  });

  it('rejects an account from another tenant before importing', async () => {
    prisma.bankAccount.findFirst.mockResolvedValue(null);
    await expect(
      service.import(
        { id: 'user-1', organizationId: 'organization-1' },
        {
          bankAccountId: 'foreign-account',
          entries: [
            {
              date: '2026-09-02',
              description: 'Movimento',
              type: BankStatementEntryType.DEBITO,
              amount: '10.00',
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('suggests compatible unmatched transactions and ranks exact dates', async () => {
    prisma.bankStatementEntry.findFirst.mockResolvedValue({
      id: 'entry-1',
      bankAccountId: 'account-1',
      type: BankStatementEntryType.CREDITO,
      amount: new Prisma.Decimal('250.00'),
      status: BankReconciliationStatus.PENDENTE,
      date: new Date('2026-09-02T12:00:00.000Z'),
    });
    prisma.financialTransaction.findMany.mockResolvedValue([
      {
        id: 'transaction-2',
        date: new Date('2026-09-04T12:00:00.000Z'),
      },
      {
        id: 'transaction-1',
        date: new Date('2026-09-02T12:00:00.000Z'),
      },
    ]);

    const result = await service.candidates('entry-1', 'organization-1');

    expect(prisma.financialTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'organization-1',
          bankAccountId: 'account-1',
          type: FinancialTransactionType.ENTRADA,
          statementEntry: null,
          reversedAt: null,
        }),
      }),
    );
    expect(result.map((item) => [item.id, item.score])).toEqual([
      ['transaction-1', 100],
      ['transaction-2', 80],
    ]);
  });

  it('matches atomically when account, type and amount agree', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'entry-1',
            bankAccountId: 'account-1',
            type: BankStatementEntryType.DEBITO,
            amount: new Prisma.Decimal('99.90'),
            status: BankReconciliationStatus.PENDENTE,
            matchedTransactionId: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'transaction-1',
            bankAccountId: 'account-1',
            type: FinancialTransactionType.SAIDA,
            amount: new Prisma.Decimal('99.90'),
            reversedAt: null,
          },
        ]),
      bankStatementEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: any) => unknown) =>
      work(tx),
    );
    prisma.bankStatementEntry.findFirst.mockResolvedValue({
      id: 'entry-1',
      status: BankReconciliationStatus.CONCILIADO,
    });

    const result = await service.match('entry-1', 'transaction-1', {
      id: 'user-1',
      organizationId: 'organization-1',
    });

    expect(tx.bankStatementEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: expect.objectContaining({
        status: BankReconciliationStatus.CONCILIADO,
        matchedTransactionId: 'transaction-1',
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'entry-1' }),
      tx,
    );
    expect(result.status).toBe(BankReconciliationStatus.CONCILIADO);
  });
});
