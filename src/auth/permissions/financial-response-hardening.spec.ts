/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PrismaService } from '../../prisma/prisma.service';
import { CompaniesService } from '../../companies/companies.service';
import { DevelopmentsService } from '../../developments/developments.service';
import { PeopleService } from '../../people/people.service';
import { UnitsService } from '../../units/units.service';
import type { AuditService } from '../../audit/audit.service';

const ACTOR = { id: 'user-a', organizationId: 'org-a' };
const AUDIT = { record: jest.fn() } as unknown as AuditService;

describe('financial response hardening', () => {
  it('omits financial relationships from nonfinancial people and companies queries', async () => {
    const prisma = {
      person: { findFirst: jest.fn().mockResolvedValue({ id: 'person-1' }) },
      company: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }),
      },
    };
    const people = new PeopleService(prisma as unknown as PrismaService);
    const companies = new CompaniesService(
      prisma as unknown as PrismaService,
      AUDIT,
    );

    await people.findOne('person-1', 'org-a');
    await companies.findAll('org-a');
    await companies.findOne('company-1', 'org-a');

    expect(prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          investments: false,
          documents: expect.objectContaining({
            where: { investmentId: null },
          }),
        }),
      }),
    );
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: {
            select: { developments: true, bankAccounts: false },
          },
        }),
      }),
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { developments: true, bankAccounts: false },
      }),
    );
  });

  it('omits allocation counts and investment-linked documents from nonfinancial operational queries', async () => {
    const prisma = {
      development: {
        findFirst: jest.fn().mockResolvedValue({ id: 'development-1' }),
      },
      unit: { findFirst: jest.fn().mockResolvedValue({ id: 'unit-1' }) },
    };
    const developments = new DevelopmentsService(
      prisma as unknown as PrismaService,
      AUDIT,
    );
    const units = new UnitsService(prisma as unknown as PrismaService, AUDIT);

    await developments.findOne('development-1', 'org-a');
    await units.findOne('unit-1', 'org-a');

    expect(prisma.development.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: {
            select: { allocations: false, units: true },
          },
        }),
      }),
    );
    expect(prisma.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          documents: expect.objectContaining({
            where: { investmentId: null },
          }),
        }),
      }),
    );
  });

  it('preserves the existing financial relationships for authorized callers', async () => {
    const prisma = {
      person: { findFirst: jest.fn().mockResolvedValue({ id: 'person-1' }) },
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
      development: {
        findFirst: jest.fn().mockResolvedValue({ id: 'development-1' }),
      },
      unit: { findFirst: jest.fn().mockResolvedValue({ id: 'unit-1' }) },
    };

    await new PeopleService(prisma as unknown as PrismaService).findOne(
      'person-1',
      'org-a',
      true,
    );
    await new CompaniesService(
      prisma as unknown as PrismaService,
      AUDIT,
    ).findOne('company-1', 'org-a', true);
    await new DevelopmentsService(
      prisma as unknown as PrismaService,
      AUDIT,
    ).findOne('development-1', 'org-a', true);
    await new UnitsService(prisma as unknown as PrismaService, AUDIT).findOne(
      'unit-1',
      'org-a',
      true,
    );

    expect(prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          investments: true,
          documents: expect.objectContaining({ where: undefined }),
        }),
      }),
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { developments: true, bankAccounts: true },
      }),
    );
    expect(prisma.development.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { allocations: true, units: true } },
        }),
      }),
    );
    expect(prisma.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          documents: expect.objectContaining({ where: undefined }),
        }),
      }),
    );
  });

  it('does not disclose financial relationship types through delete conflicts', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'development-1' }]),
      allocation: { count: jest.fn().mockResolvedValue(1) },
    };
    const prisma = {
      person: { findFirst: jest.fn().mockResolvedValue({ id: 'person-1' }) },
      investment: { count: jest.fn().mockResolvedValue(1) },
      unitReservation: { count: jest.fn().mockResolvedValue(0) },
      development: {
        findFirst: jest.fn().mockResolvedValue({ id: 'development-1' }),
        delete: jest.fn(),
      },
      allocation: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const people = new PeopleService(prisma as unknown as PrismaService);
    const developments = new DevelopmentsService(
      prisma as unknown as PrismaService,
      AUDIT,
    );

    await expect(people.remove('person-1', 'org-a')).rejects.toMatchObject({
      message: 'Pessoa possui vínculos existentes e não pode ser removida',
    });
    await expect(
      developments.remove('development-1', ACTOR),
    ).rejects.toMatchObject({
      message:
        'Empreendimento possui vínculos existentes e não pode ser removido',
    });
  });
});
