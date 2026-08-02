import { BadRequestException } from '@nestjs/common';
import { InvestmentType, PersonRoleType, ReturnStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportFormat } from './dto/report-format-query.dto';
import { ExcelReportExporter } from './exporters/excel-report.exporter';
import { PdfReportExporter } from './exporters/pdf-report.exporter';
import { MAX_REPORT_ROWS, ReportsService } from './reports.service';
import { ReportData, ReportValue } from './types/report.types';

const ORGANIZATION_ID = 'organization-a';
const FIXED_NOW = new Date('2026-08-02T12:00:00.000Z');

describe('ReportsService', () => {
  let prisma: PrismaMock;
  let excelExporter: ExporterMock;
  let pdfExporter: ExporterMock;
  let service: FixedNowReportsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    excelExporter = createExporterMock('xlsx');
    pdfExporter = createExporterMock('pdf');
    service = new FixedNowReportsService(
      prisma as unknown as PrismaService,
      excelExporter as unknown as ExcelReportExporter,
      pdfExporter as unknown as PdfReportExporter,
    );
  });

  it('rejects a development from another organization without querying report data', async () => {
    prisma.development.findFirst.mockResolvedValue(null);

    await expect(
      service.captations(ORGANIZATION_ID, {
        format: ReportFormat.XLSX,
        developmentId: 'development-from-organization-b',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.development.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'development-from-organization-b',
        organizationId: ORGANIZATION_ID,
      },
      select: { id: true, name: true },
    });
    expect(prisma.investment.findMany).not.toHaveBeenCalled();
    expect(prisma.allocation.findMany).not.toHaveBeenCalled();
  });

  it('rejects an investor from another organization without revealing data', async () => {
    prisma.person.findFirst.mockResolvedValue(null);

    await expect(
      service.returns(ORGANIZATION_ID, {
        format: ReportFormat.XLSX,
        investorId: 'investor-from-organization-b',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.person.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'investor-from-organization-b',
        organizationId: ORGANIZATION_ID,
        roles: { some: { role: PersonRoleType.INVESTIDOR } },
      },
      select: { id: true, name: true },
    });
    expect(prisma.return.findMany).not.toHaveBeenCalled();
  });

  it('validates invalid and inverted periods in the service before querying Prisma', async () => {
    await expect(
      service.captations(ORGANIZATION_ID, {
        format: ReportFormat.XLSX,
        startDate: '2026-02-30',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.captations(ORGANIZATION_ID, {
        format: ReportFormat.XLSX,
        startDate: '2026-08-02',
        endDate: '2026-08-01',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.captations(ORGANIZATION_ID, {
        format: ReportFormat.XLSX,
        startDate: '2026-08-01',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.captations(ORGANIZATION_ID, {
        format: ReportFormat.XLSX,
        startDate: '2025-01-01',
        endDate: '2026-08-01',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.investment.findMany).not.toHaveBeenCalled();
  });

  it('consolidates captations without duplicating investments with no allocation, multiple developments, and general cash', async () => {
    prisma.investment.findMany.mockResolvedValue([
      {
        id: 'investment-without-allocation',
        amount: 100,
        date: date('2026-06-01'),
        type: InvestmentType.FINANCEIRO,
        notes: null,
        investor: {
          id: 'investor-a',
          name: 'Ana',
          document: '111.111.111-11',
        },
        allocations: [],
      },
      {
        id: 'investment-with-multiple-allocations',
        amount: 1000,
        date: date('2026-06-02'),
        type: InvestmentType.FINANCEIRO,
        notes: 'Aporte dividido',
        investor: {
          id: 'investor-b',
          name: 'Bruno',
          document: '222.222.222-22',
        },
        allocations: [
          {
            amount: 500,
            developmentId: 'development-1',
            development: { id: 'development-1', name: 'Alvorada' },
          },
          {
            amount: 200,
            developmentId: 'development-2',
            development: { id: 'development-2', name: 'Bosque' },
          },
          {
            amount: 300,
            developmentId: null,
            development: null,
          },
        ],
      },
    ]);
    prisma.allocation.findMany.mockResolvedValue([
      {
        investmentId: 'investment-with-multiple-allocations',
        amount: 500,
        developmentId: 'development-1',
        development: { id: 'development-1', name: 'Alvorada' },
      },
      {
        investmentId: 'investment-with-multiple-allocations',
        amount: 200,
        developmentId: 'development-2',
        development: { id: 'development-2', name: 'Bosque' },
      },
      {
        investmentId: 'investment-with-multiple-allocations',
        amount: 300,
        developmentId: null,
        development: null,
      },
    ]);

    await service.captations(ORGANIZATION_ID, {
      format: ReportFormat.XLSX,
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });

    expect(prisma.investment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORGANIZATION_ID,
          date: {
            gte: date('2026-06-01'),
            lt: date('2026-07-01'),
          },
        },
      }),
    );
    expect(prisma.allocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORGANIZATION_ID,
          investmentId: {
            in: [
              'investment-without-allocation',
              'investment-with-multiple-allocations',
            ],
          },
        },
        take: MAX_REPORT_ROWS + 1,
      }),
    );

    const report = exportedReport(excelExporter);
    expect(report.rows).toEqual([
      expect.objectContaining({
        investor: 'Ana',
        totalAmount: 100,
        developmentAllocated: 0,
        generalCash: 0,
        unassigned: 100,
      }),
      expect.objectContaining({
        investor: 'Bruno',
        totalAmount: 1000,
        developmentAllocated: 700,
        generalCash: 300,
        unassigned: 0,
        developments: 'Alvorada, Bosque',
      }),
    ]);
    expect(summaryValue(report, 'Total captado')).toBe(1100);
    expect(summaryValue(report, 'Total destinado a empreendimentos')).toBe(700);
    expect(summaryValue(report, 'Total em caixa geral')).toBe(300);
    expect(summaryValue(report, 'Saldo não alocado')).toBe(100);
  });

  it('stops captation generation when the related allocations exceed the report limit', async () => {
    prisma.investment.findMany.mockResolvedValue([
      {
        id: 'investment-1',
        amount: 1,
        date: date('2026-06-01'),
        type: InvestmentType.FINANCEIRO,
        notes: null,
        investor: { id: 'investor-a', name: 'Ana', document: '111' },
      },
    ]);
    prisma.allocation.findMany.mockResolvedValue(
      Array.from({ length: MAX_REPORT_ROWS + 1 }, () => ({
        investmentId: 'investment-1',
        amount: 1,
        developmentId: null,
        development: null,
      })),
    );

    await expect(
      service.captations(ORGANIZATION_ID, { format: ReportFormat.XLSX }),
    ).rejects.toThrow(BadRequestException);
    expect(excelExporter.export).not.toHaveBeenCalled();
  });

  it('calculates pending, overdue, and paid return statuses and totals using the organization-scoped query', async () => {
    prisma.return.findMany.mockResolvedValue([
      returnRecord({
        id: 'return-future',
        expectedAmount: 100,
        expectedDate: date('2026-08-03'),
        realizedAmount: null,
        realizedDate: null,
        status: ReturnStatus.PENDENTE,
      }),
      returnRecord({
        id: 'return-overdue',
        expectedAmount: 200,
        expectedDate: date('2026-08-01'),
        realizedAmount: null,
        realizedDate: null,
        status: ReturnStatus.PENDENTE,
      }),
      returnRecord({
        id: 'return-paid',
        expectedAmount: 300,
        expectedDate: date('2026-07-15'),
        realizedAmount: 280,
        realizedDate: date('2026-07-16'),
        status: ReturnStatus.PAGO,
      }),
    ]);

    await service.returns(ORGANIZATION_ID, { format: ReportFormat.XLSX });

    expect(prisma.return.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORGANIZATION_ID,
          allocation: {
            organizationId: ORGANIZATION_ID,
            investment: { organizationId: ORGANIZATION_ID },
          },
        },
      }),
    );

    const report = exportedReport(excelExporter);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectedAmount: 100,
          status: ReturnStatus.PENDENTE,
        }),
        expect.objectContaining({
          expectedAmount: 200,
          status: ReturnStatus.ATRASADO,
        }),
        expect.objectContaining({
          expectedAmount: 300,
          realizedAmount: 280,
          difference: -20,
          status: ReturnStatus.PAGO,
        }),
      ]),
    );
    expect(summaryValue(report, 'Total previsto')).toBe(600);
    expect(summaryValue(report, 'Total realizado')).toBe(280);
    expect(summaryValue(report, 'Total pendente')).toBe(100);
    expect(summaryValue(report, 'Total atrasado')).toBe(200);
    expect(summaryValue(report, 'Quantidade pendente')).toBe(1);
    expect(summaryValue(report, 'Quantidade paga')).toBe(1);
    expect(summaryValue(report, 'Quantidade atrasada')).toBe(1);

    await service.returns(ORGANIZATION_ID, {
      format: ReportFormat.XLSX,
      status: ReturnStatus.ATRASADO,
    });

    const overdueOnly = exportedReport(excelExporter, 1);
    expect(overdueOnly.rows).toEqual([
      expect.objectContaining({
        expectedAmount: 200,
        status: ReturnStatus.ATRASADO,
      }),
    ]);
    expect(prisma.return.findMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        organizationId: ORGANIZATION_ID,
        AND: [
          {
            OR: [
              { status: ReturnStatus.ATRASADO },
              {
                status: ReturnStatus.PENDENTE,
                expectedDate: { lt: FIXED_NOW },
              },
            ],
          },
        ],
      },
    });
  });

  it('loads the latest interaction inside the overdue returns query without N+1 calls', async () => {
    prisma.return.findMany.mockResolvedValue([
      {
        id: 'overdue-return',
        expectedAmount: 750,
        expectedDate: date('2026-08-08'),
        allocation: {
          development: { id: 'development-1', name: 'Alvorada' },
          investment: {
            investor: {
              id: 'investor-a',
              name: 'Ana',
              email: 'ana@example.com',
              phone: '11999999999',
              interactions: [
                {
                  date: date('2026-08-09'),
                  summary: 'Contato realizado',
                  nextStep: 'Enviar atualização',
                },
              ],
            },
          },
        },
      },
    ]);

    await service.overdueReturns(ORGANIZATION_ID, {
      format: ReportFormat.XLSX,
      asOfDate: '2026-08-10',
    });

    expect(prisma.return.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.person.findFirst).not.toHaveBeenCalled();
    const overdueQuery = prisma.return.findMany.mock.calls[0]?.[0] as {
      where: unknown;
      select: {
        allocation: {
          select: {
            investment: {
              select: {
                investor: { select: { interactions: unknown } };
              };
            };
          };
        };
      };
    };
    expect(overdueQuery.where).toMatchObject({
      organizationId: ORGANIZATION_ID,
      status: ReturnStatus.PENDENTE,
      expectedDate: { lt: date('2026-08-10') },
      allocation: {
        organizationId: ORGANIZATION_ID,
        investment: { organizationId: ORGANIZATION_ID },
      },
    });
    expect(
      overdueQuery.select.allocation.select.investment.select.investor.select
        .interactions,
    ).toEqual({
      where: { organizationId: ORGANIZATION_ID },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: {
        date: true,
        summary: true,
        nextStep: true,
      },
    });

    const report = exportedReport(excelExporter);
    expect(report.rows[0]).toEqual(
      expect.objectContaining({
        investor: 'Ana',
        expectedAmount: 750,
        daysOverdue: 2,
        nextStep: 'Enviar atualização',
      }),
    );
    expect(report.rows[0]?.latestInteraction).toEqual(
      expect.stringContaining('Contato realizado'),
    );
    expect(summaryValue(report, 'Valor total atrasado')).toBe(750);
  });

  it('builds investor positions from distinct investments, allocations, and returns without multiplying totals', async () => {
    prisma.investment.findMany.mockResolvedValue([
      {
        id: 'investment-1',
        amount: 1000,
        investor: {
          id: 'investor-a',
          name: 'Ana',
          document: '111.111.111-11',
          email: 'ana@example.com',
          phone: null,
        },
      },
      {
        id: 'investment-2',
        amount: 200,
        investor: {
          id: 'investor-a',
          name: 'Ana',
          document: '111.111.111-11',
          email: 'ana@example.com',
          phone: null,
        },
      },
    ]);
    prisma.allocation.findMany.mockResolvedValue([
      {
        id: 'allocation-development',
        investmentId: 'investment-1',
        amount: 400,
        developmentId: 'development-1',
        development: { id: 'development-1', name: 'Alvorada' },
      },
      {
        id: 'allocation-general-cash',
        investmentId: 'investment-1',
        amount: 300,
        developmentId: null,
        development: null,
      },
    ]);
    prisma.return.findMany.mockResolvedValue([
      {
        allocationId: 'allocation-development',
        expectedAmount: 60,
        expectedDate: date('2026-07-15'),
        realizedAmount: 60,
        status: ReturnStatus.PAGO,
      },
      {
        allocationId: 'allocation-development',
        expectedAmount: 40,
        expectedDate: date('2026-08-03'),
        realizedAmount: null,
        status: ReturnStatus.PENDENTE,
      },
      {
        allocationId: 'allocation-general-cash',
        expectedAmount: 50,
        expectedDate: date('2026-08-01'),
        realizedAmount: null,
        status: ReturnStatus.PENDENTE,
      },
    ]);

    await service.investorPositions(ORGANIZATION_ID, {
      format: ReportFormat.XLSX,
    });

    expect(prisma.investment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORGANIZATION_ID } }),
    );
    expect(prisma.allocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORGANIZATION_ID,
          investmentId: { in: ['investment-1', 'investment-2'] },
        },
      }),
    );
    expect(prisma.return.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORGANIZATION_ID,
          allocationId: {
            in: ['allocation-development', 'allocation-general-cash'],
          },
        },
      }),
    );

    const report = exportedReport(excelExporter);
    expect(report.rows).toEqual([
      expect.objectContaining({
        investor: 'Ana',
        totalInvested: 1200,
        developmentAllocated: 400,
        generalCash: 300,
        unassigned: 500,
        expectedReturns: 150,
        paidReturns: 60,
        pendingReturns: 40,
        overdueReturns: 50,
        developments: 'Alvorada',
      }),
    ]);
    expect(summaryValue(report, 'Total investido')).toBe(1200);
    expect(summaryValue(report, 'Retornos previstos')).toBe(150);
    expect(summaryValue(report, 'Retornos pagos')).toBe(60);
    expect(summaryValue(report, 'Retornos pendentes')).toBe(40);
    expect(summaryValue(report, 'Retornos atrasados')).toBe(50);
  });
});

class FixedNowReportsService extends ReportsService {
  constructor(
    prisma: PrismaService,
    excelExporter: ExcelReportExporter,
    pdfExporter: PdfReportExporter,
  ) {
    super(prisma, excelExporter, pdfExporter);
  }

  protected getNow(): Date {
    return new Date(FIXED_NOW);
  }
}

interface PrismaMock {
  development: { findFirst: QueryMock };
  person: { findFirst: QueryMock };
  investment: { findMany: QueryMock };
  allocation: { findMany: QueryMock };
  return: { findMany: QueryMock };
}

interface ExporterMock {
  export: jest.Mock<Promise<Buffer>, [ReportData]>;
}

type QueryMock = jest.Mock<Promise<unknown>, [unknown]>;

function createPrismaMock(): PrismaMock {
  return {
    development: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(null),
    },
    person: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(null),
    },
    investment: {
      findMany: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([]),
    },
    allocation: {
      findMany: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([]),
    },
    return: {
      findMany: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([]),
    },
  };
}

function createExporterMock(contents: string): ExporterMock {
  return {
    export: jest
      .fn<Promise<Buffer>, [ReportData]>()
      .mockResolvedValue(Buffer.from(contents)),
  };
}

function exportedReport(exporter: ExporterMock, call = 0): ReportData {
  const report = exporter.export.mock.calls[call]?.[0];
  if (!report) {
    throw new Error('Expected the exporter to receive report data');
  }
  return report;
}

function summaryValue(report: ReportData, label: string): ReportValue {
  const summary = report.summary.find((item) => item.label === label);
  if (!summary) {
    throw new Error(`Missing report summary item: ${label}`);
  }
  return summary.value;
}

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function returnRecord(overrides: {
  id: string;
  expectedAmount: number;
  expectedDate: Date;
  realizedAmount: number | null;
  realizedDate: Date | null;
  status: ReturnStatus;
}) {
  return {
    ...overrides,
    allocation: {
      id: `allocation-for-${overrides.id}`,
      development: { id: 'development-1', name: 'Alvorada' },
      investment: {
        id: `investment-for-${overrides.id}`,
        date: date('2026-01-10'),
        investor: {
          id: 'investor-a',
          name: 'Ana',
          document: '111.111.111-11',
        },
      },
    },
  };
}
