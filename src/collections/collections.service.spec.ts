import { Prisma } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CollectionEmailService } from './collection-email.service';
import { CollectionsService } from './collections.service';

describe('CollectionsService', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const email = {
    configured: false,
    send: jest.fn(),
  } as unknown as CollectionEmailService;

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('creates safe inactive defaults only when the tenant has no rules', async () => {
    const prisma = {
      collectionRule: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new CollectionsService(prisma, audit, email);

    await service.listRules('organization-a');

    expect(prisma.collectionRule.count).toHaveBeenCalledWith({
      where: { organizationId: 'organization-a' },
    });
    const defaults = (prisma.collectionRule.createMany as jest.Mock).mock
      .calls[0][0].data;
    expect(defaults).toHaveLength(3);
    expect(defaults.every((rule: { active: boolean }) => !rule.active)).toBe(
      true,
    );
    expect(
      defaults.every(
        (rule: { organizationId: string }) =>
          rule.organizationId === 'organization-a',
      ),
    ).toBe(true);
  });

  it('generates a tenant-scoped dispatch for the exact scheduled day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      collectionDispatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany,
        findMany: jest.fn().mockResolvedValue([]),
      },
      collectionRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-1',
            organizationId: 'organization-a',
            daysOffset: 3,
            subject: 'Olá {{cliente}}',
            message: '{{parcela}} vence em {{vencimento}}: {{valor}}',
            active: true,
          },
        ]),
      },
      receivable: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'receivable-1',
            description: 'Parcela 01/12',
            dueDate: new Date('2026-08-30T00:00:00.000Z'),
            adjustedAmount: new Prisma.Decimal('1000'),
            paidAmount: new Prisma.Decimal('100'),
            sale: {
              saleNumber: 'VEN-1',
              development: { name: 'Aurora' },
              unit: { identifier: '101' },
              buyers: [
                {
                  isPrimary: true,
                  person: {
                    name: 'Cliente Teste',
                    email: 'CLIENTE@EXAMPLE.COM',
                  },
                },
              ],
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new CollectionsService(prisma, audit, email);

    const result = await service.run('organization-a');

    expect(prisma.receivable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'organization-a' }),
      }),
    );
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            organizationId: 'organization-a',
            ruleId: 'rule-1',
            receivableId: 'receivable-1',
            recipient: 'cliente@example.com',
            balanceSnapshot: new Prisma.Decimal('900'),
            subject: 'Olá Cliente Teste',
          }),
        ],
      }),
    );
    expect(result).toEqual({
      generated: 1,
      sent: 0,
      failed: 0,
      cancelled: 0,
      providerConfigured: false,
    });
  });
});
