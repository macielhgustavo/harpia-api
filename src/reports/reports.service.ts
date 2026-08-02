import { BadRequestException, Injectable } from '@nestjs/common';
import { PersonRoleType, Prisma, ReturnStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getComputedReturnStatus } from '../returns/return-status';
import { CaptationsReportQueryDto } from './dto/captations-report-query.dto';
import { InvestorPositionsReportQueryDto } from './dto/investor-positions-report-query.dto';
import { OverdueReturnsReportQueryDto } from './dto/overdue-returns-report-query.dto';
import { ReportFormat } from './dto/report-format-query.dto';
import { ReturnsReportQueryDto } from './dto/returns-report-query.dto';
import { ExcelReportExporter } from './exporters/excel-report.exporter';
import { PdfReportExporter } from './exporters/pdf-report.exporter';
import {
  formatIsoDate,
  getInclusiveReportPeriod,
  parseIsoCalendarDate,
  utcCalendarDaysBetween,
} from './report-date.utils';
import { centsToMoney, moneyToCents, sumMoney } from './report-money.utils';
import {
  ReportColumn,
  ReportData,
  ReportFilter,
  ReportRow,
  ReportSummaryItem,
} from './types/report.types';

export const MAX_REPORT_ROWS = 5_000;

export interface GeneratedReport {
  buffer: Buffer;
  contentType: string;
  extension: 'xlsx' | 'pdf';
}

interface ReportReferences {
  developmentName?: string;
  investorName?: string;
}

interface InvestorPositionAccumulator {
  id: string;
  name: string;
  document: string;
  contact: string;
  totalInvestedCents: number;
  developmentAllocatedCents: number;
  generalCashCents: number;
  unassignedCents: number;
  expectedCents: number;
  paidCents: number;
  pendingCents: number;
  overdueCents: number;
  developmentNames: Set<string>;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excelExporter: ExcelReportExporter,
    private readonly pdfExporter: PdfReportExporter,
  ) {}

  async captations(
    organizationId: string,
    query: CaptationsReportQueryDto,
  ): Promise<GeneratedReport> {
    const generatedAt = this.getNow();
    const references = await this.validateReferences(organizationId, query);
    const period = getInclusiveReportPeriod(query.startDate, query.endDate);
    const report = query.developmentId
      ? await this.buildDevelopmentCaptationsReport(
          organizationId,
          query,
          references,
          generatedAt,
          period,
        )
      : await this.buildCaptationsReport(
          organizationId,
          query,
          references,
          generatedAt,
          period,
        );

    return this.export(report, query.format);
  }

  async returns(
    organizationId: string,
    query: ReturnsReportQueryDto,
  ): Promise<GeneratedReport> {
    const generatedAt = this.getNow();
    const references = await this.validateReferences(organizationId, query);
    const period = getInclusiveReportPeriod(query.startDate, query.endDate);
    const expectedDateFilter = this.toDateFilter(period);
    const where: Prisma.ReturnWhereInput = {
      organizationId,
      allocation: {
        organizationId,
        ...(query.developmentId ? { developmentId: query.developmentId } : {}),
        investment: {
          organizationId,
          ...(query.investorId ? { investorId: query.investorId } : {}),
        },
      },
      ...(expectedDateFilter ? { expectedDate: expectedDateFilter } : {}),
    };
    const calculatedStatusWhere = this.toCalculatedStatusWhere(
      query.status,
      generatedAt,
    );
    if (calculatedStatusWhere) {
      where.AND = [calculatedStatusWhere];
    }

    const returns = await this.prisma.return.findMany({
      where,
      take: MAX_REPORT_ROWS + 1,
      orderBy: { expectedDate: 'asc' },
      select: {
        id: true,
        expectedAmount: true,
        expectedDate: true,
        realizedAmount: true,
        realizedDate: true,
        status: true,
        allocation: {
          select: {
            id: true,
            development: { select: { id: true, name: true } },
            investment: {
              select: {
                id: true,
                date: true,
                investor: {
                  select: { id: true, name: true, document: true },
                },
              },
            },
          },
        },
      },
    });
    this.assertWithinLimit(returns.length, 'retornos');

    const normalized = returns
      .map((item) => ({
        ...item,
        computedStatus: getComputedReturnStatus(
          item.status,
          item.expectedDate,
          generatedAt,
        ),
      }))
      .filter((item) => !query.status || item.computedStatus === query.status);

    const rows: ReportRow[] = normalized.map((item) => {
      const difference =
        item.realizedAmount == null
          ? null
          : centsToMoney(
              moneyToCents(item.realizedAmount) -
                moneyToCents(item.expectedAmount),
            );
      return {
        investor: item.allocation.investment.investor.name,
        investment: `Aporte de ${formatIsoDate(item.allocation.investment.date)}`,
        allocation: item.allocation.id,
        destination: item.allocation.development?.name ?? 'Caixa geral',
        expectedAmount: item.expectedAmount,
        expectedDate: formatIsoDate(item.expectedDate),
        status: item.computedStatus,
        realizedAmount: item.realizedAmount,
        realizedDate: item.realizedDate
          ? formatIsoDate(item.realizedDate)
          : null,
        difference,
      };
    });

    const report: ReportData = {
      title: 'Retornos previstos e realizados',
      sheetName: 'Retornos',
      generatedAt,
      filters: this.periodFilters(query, references),
      columns: [
        textColumn('investor', 'Investidor', 22),
        textColumn('investment', 'Investimento de origem', 18),
        textColumn('allocation', 'Alocação', 16),
        textColumn('destination', 'Empreendimento / destino', 22),
        currencyColumn('expectedAmount', 'Valor previsto', 16),
        dateColumn('expectedDate', 'Data prevista', 14),
        textColumn('status', 'Status calculado', 14),
        currencyColumn('realizedAmount', 'Valor realizado', 16),
        dateColumn('realizedDate', 'Data realizada', 14),
        currencyColumn('difference', 'Diferença', 14),
      ],
      rows,
      summary: this.returnSummary(normalized),
    };

    return this.export(report, query.format);
  }

  async overdueReturns(
    organizationId: string,
    query: OverdueReturnsReportQueryDto,
  ): Promise<GeneratedReport> {
    const generatedAt = this.getNow();
    const references = await this.validateReferences(organizationId, query);
    const asOfDate = query.asOfDate
      ? parseIsoCalendarDate(query.asOfDate, 'asOfDate')
      : this.startOfUtcDay(generatedAt);

    const returns = await this.prisma.return.findMany({
      where: {
        organizationId,
        status: ReturnStatus.PENDENTE,
        expectedDate: { lt: asOfDate },
        allocation: {
          organizationId,
          ...(query.developmentId
            ? { developmentId: query.developmentId }
            : {}),
          investment: {
            organizationId,
            ...(query.investorId ? { investorId: query.investorId } : {}),
          },
        },
      },
      take: MAX_REPORT_ROWS + 1,
      orderBy: { expectedDate: 'asc' },
      select: {
        id: true,
        expectedAmount: true,
        expectedDate: true,
        allocation: {
          select: {
            development: { select: { id: true, name: true } },
            investment: {
              select: {
                investor: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    interactions: {
                      where: { organizationId },
                      orderBy: [
                        { date: 'desc' },
                        { createdAt: 'desc' },
                        { id: 'desc' },
                      ],
                      take: 1,
                      select: {
                        date: true,
                        summary: true,
                        nextStep: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    this.assertWithinLimit(returns.length, 'retornos em atraso');

    const overdueDays = returns.map((item) =>
      Math.max(1, utcCalendarDaysBetween(item.expectedDate, asOfDate)),
    );
    const rows: ReportRow[] = returns.map((item, index) => {
      const investor = item.allocation.investment.investor;
      const latestInteraction = investor.interactions[0];
      return {
        investor: investor.name,
        contact:
          [investor.email, investor.phone].filter(Boolean).join(' · ') || '—',
        destination: item.allocation.development?.name ?? 'Caixa geral',
        expectedAmount: item.expectedAmount,
        expectedDate: formatIsoDate(item.expectedDate),
        daysOverdue: overdueDays[index],
        latestInteraction: latestInteraction
          ? `${formatIsoDate(latestInteraction.date)} — ${latestInteraction.summary}`
          : 'Sem interação registrada',
        nextStep: latestInteraction?.nextStep ?? '—',
      };
    });

    const report: ReportData = {
      title: 'Retornos em atraso',
      sheetName: 'Retornos em atraso',
      generatedAt,
      filters: [
        ...this.referenceFilters(references),
        { label: 'Data de referência', value: formatIsoDate(asOfDate) },
      ],
      columns: [
        textColumn('investor', 'Investidor', 22),
        textColumn('contact', 'Contato', 28),
        textColumn('destination', 'Empreendimento / destino', 22),
        currencyColumn('expectedAmount', 'Valor previsto', 16),
        dateColumn('expectedDate', 'Vencimento', 14),
        numberColumn('daysOverdue', 'Dias em atraso', 12),
        textColumn('latestInteraction', 'Última interação', 34),
        textColumn('nextStep', 'Próximo passo', 26),
      ],
      rows,
      summary: [
        {
          label: 'Quantidade de retornos atrasados',
          value: returns.length,
          kind: 'number',
        },
        {
          label: 'Valor total atrasado',
          value: sumMoney(returns.map((item) => item.expectedAmount)),
          kind: 'currency',
        },
        {
          label: 'Investidores afetados',
          value: new Set(
            returns.map((item) => item.allocation.investment.investor.id),
          ).size,
          kind: 'number',
        },
        {
          label: 'Atraso médio em dias',
          value: overdueDays.length
            ? Math.round(
                (overdueDays.reduce((sum, days) => sum + days, 0) /
                  overdueDays.length) *
                  100,
              ) / 100
            : 0,
          kind: 'number',
        },
        {
          label: 'Maior atraso em dias',
          value: overdueDays.length ? Math.max(...overdueDays) : 0,
          kind: 'number',
        },
      ],
    };

    return this.export(report, query.format);
  }

  async investorPositions(
    organizationId: string,
    query: InvestorPositionsReportQueryDto,
  ): Promise<GeneratedReport> {
    const generatedAt = this.getNow();
    const references = await this.validateReferences(organizationId, query);
    const investmentWhere: Prisma.InvestmentWhereInput = {
      organizationId,
      ...(query.investorId ? { investorId: query.investorId } : {}),
      ...(query.developmentId
        ? {
            allocations: {
              some: {
                organizationId,
                developmentId: query.developmentId,
              },
            },
          }
        : {}),
    };

    const investments = await this.prisma.investment.findMany({
      where: investmentWhere,
      take: MAX_REPORT_ROWS + 1,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        investor: {
          select: {
            id: true,
            name: true,
            document: true,
            email: true,
            phone: true,
          },
        },
      },
    });
    this.assertWithinLimit(investments.length, 'aportes para posição');

    const investmentIds = investments.map((investment) => investment.id);
    const allocations = investmentIds.length
      ? await this.prisma.allocation.findMany({
          where: {
            organizationId,
            investmentId: { in: investmentIds },
            ...(query.developmentId
              ? { developmentId: query.developmentId }
              : {}),
          },
          take: MAX_REPORT_ROWS + 1,
          select: {
            id: true,
            investmentId: true,
            amount: true,
            developmentId: true,
            development: { select: { id: true, name: true } },
          },
        })
      : [];
    this.assertWithinLimit(allocations.length, 'alocações para posição');

    const allocationIds = allocations.map((allocation) => allocation.id);
    const returns = allocationIds.length
      ? await this.prisma.return.findMany({
          where: {
            organizationId,
            allocationId: { in: allocationIds },
          },
          take: MAX_REPORT_ROWS + 1,
          select: {
            allocationId: true,
            expectedAmount: true,
            expectedDate: true,
            realizedAmount: true,
            status: true,
          },
        })
      : [];
    this.assertWithinLimit(returns.length, 'retornos para posição');

    const allocationsByInvestment = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      const current =
        allocationsByInvestment.get(allocation.investmentId) ?? [];
      current.push(allocation);
      allocationsByInvestment.set(allocation.investmentId, current);
    }
    const returnsByAllocation = new Map<string, typeof returns>();
    for (const item of returns) {
      const current = returnsByAllocation.get(item.allocationId) ?? [];
      current.push(item);
      returnsByAllocation.set(item.allocationId, current);
    }

    const positions = new Map<string, InvestorPositionAccumulator>();
    for (const investment of investments) {
      const investor = investment.investor;
      const position =
        positions.get(investor.id) ?? this.createPositionAccumulator(investor);
      const investmentAllocations =
        allocationsByInvestment.get(investment.id) ?? [];

      if (query.developmentId) {
        position.totalInvestedCents += moneyToCents(
          sumMoney(
            investmentAllocations.map((allocation) => allocation.amount),
          ),
        );
      } else {
        position.totalInvestedCents += moneyToCents(investment.amount);
      }

      let allocationCents = 0;
      for (const allocation of investmentAllocations) {
        const allocationCentsValue = moneyToCents(allocation.amount);
        allocationCents += allocationCentsValue;
        if (allocation.developmentId) {
          position.developmentAllocatedCents += allocationCentsValue;
          if (allocation.development) {
            position.developmentNames.add(allocation.development.name);
          }
        } else {
          position.generalCashCents += allocationCentsValue;
        }

        for (const item of returnsByAllocation.get(allocation.id) ?? []) {
          const status = getComputedReturnStatus(
            item.status,
            item.expectedDate,
            generatedAt,
          );
          position.expectedCents += moneyToCents(item.expectedAmount);
          if (status === ReturnStatus.PAGO) {
            position.paidCents += moneyToCents(item.realizedAmount);
          } else if (status === ReturnStatus.ATRASADO) {
            position.overdueCents += moneyToCents(item.expectedAmount);
          } else {
            position.pendingCents += moneyToCents(item.expectedAmount);
          }
        }
      }

      if (!query.developmentId) {
        position.unassignedCents +=
          moneyToCents(investment.amount) - allocationCents;
      }
      positions.set(investor.id, position);
    }

    const rows: ReportRow[] = [...positions.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
      .map((position) => ({
        investor: position.name,
        document: position.document,
        contact: position.contact,
        totalInvested: centsToMoney(position.totalInvestedCents),
        developmentAllocated: centsToMoney(position.developmentAllocatedCents),
        generalCash: centsToMoney(position.generalCashCents),
        unassigned: centsToMoney(position.unassignedCents),
        expectedReturns: centsToMoney(position.expectedCents),
        paidReturns: centsToMoney(position.paidCents),
        pendingReturns: centsToMoney(position.pendingCents),
        overdueReturns: centsToMoney(position.overdueCents),
        developments: [...position.developmentNames].sort().join(', ') || '—',
      }));

    const report: ReportData = {
      title: query.developmentId
        ? 'Posição de investimentos por investidor — empreendimento selecionado'
        : 'Posição de investimentos por investidor',
      sheetName: 'Posição por investidor',
      generatedAt,
      filters: this.referenceFilters(references),
      columns: [
        textColumn('investor', 'Investidor', 20),
        textColumn('document', 'Documento', 16),
        textColumn('contact', 'Contato', 26),
        currencyColumn(
          'totalInvested',
          query.developmentId ? 'Capital no empreendimento' : 'Total investido',
          17,
        ),
        currencyColumn(
          'developmentAllocated',
          'Alocado em empreendimentos',
          18,
        ),
        currencyColumn('generalCash', 'Caixa geral', 15),
        currencyColumn('unassigned', 'Saldo não alocado', 16),
        currencyColumn('expectedReturns', 'Retornos previstos', 16),
        currencyColumn('paidReturns', 'Retornos pagos', 16),
        currencyColumn('pendingReturns', 'Retornos pendentes', 16),
        currencyColumn('overdueReturns', 'Retornos atrasados', 16),
        textColumn('developments', 'Empreendimentos relacionados', 28),
      ],
      rows,
      summary: [
        {
          label: query.developmentId
            ? 'Capital no empreendimento'
            : 'Total investido',
          value: sumMoney(rows.map((row) => row.totalInvested as number)),
          kind: 'currency',
        },
        {
          label: 'Total alocado em empreendimentos',
          value: sumMoney(
            rows.map((row) => row.developmentAllocated as number),
          ),
          kind: 'currency',
        },
        {
          label: 'Total em caixa geral',
          value: sumMoney(rows.map((row) => row.generalCash as number)),
          kind: 'currency',
        },
        {
          label: 'Saldo não alocado',
          value: sumMoney(rows.map((row) => row.unassigned as number)),
          kind: 'currency',
        },
        {
          label: 'Retornos previstos',
          value: sumMoney(rows.map((row) => row.expectedReturns as number)),
          kind: 'currency',
        },
        {
          label: 'Retornos pagos',
          value: sumMoney(rows.map((row) => row.paidReturns as number)),
          kind: 'currency',
        },
        {
          label: 'Retornos pendentes',
          value: sumMoney(rows.map((row) => row.pendingReturns as number)),
          kind: 'currency',
        },
        {
          label: 'Retornos atrasados',
          value: sumMoney(rows.map((row) => row.overdueReturns as number)),
          kind: 'currency',
        },
        { label: 'Investidores', value: rows.length, kind: 'number' },
      ],
    };

    return this.export(report, query.format);
  }

  protected getNow(): Date {
    return new Date();
  }

  private async buildCaptationsReport(
    organizationId: string,
    query: CaptationsReportQueryDto,
    references: ReportReferences,
    generatedAt: Date,
    period: ReturnType<typeof getInclusiveReportPeriod>,
  ): Promise<ReportData> {
    const dateFilter = this.toDateFilter(period);
    const investments = await this.prisma.investment.findMany({
      where: {
        organizationId,
        ...(query.investorId ? { investorId: query.investorId } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
      },
      take: MAX_REPORT_ROWS + 1,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        date: true,
        type: true,
        notes: true,
        investor: { select: { id: true, name: true, document: true } },
      },
    });
    this.assertWithinLimit(investments.length, 'aportes');

    const investmentIds = investments.map((investment) => investment.id);
    const allocations = investmentIds.length
      ? await this.prisma.allocation.findMany({
          where: {
            organizationId,
            investmentId: { in: investmentIds },
          },
          take: MAX_REPORT_ROWS + 1,
          select: {
            investmentId: true,
            amount: true,
            developmentId: true,
            development: { select: { id: true, name: true } },
          },
        })
      : [];
    this.assertWithinLimit(allocations.length, 'alocações de captação');

    const allocationsByInvestment = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      const current =
        allocationsByInvestment.get(allocation.investmentId) ?? [];
      current.push(allocation);
      allocationsByInvestment.set(allocation.investmentId, current);
    }

    const rows: ReportRow[] = investments.map((investment) => {
      const investmentAllocations =
        allocationsByInvestment.get(investment.id) ?? [];
      const developmentAllocated = sumMoney(
        investmentAllocations
          .filter((allocation) => allocation.developmentId)
          .map((allocation) => allocation.amount),
      );
      const generalCash = sumMoney(
        investmentAllocations
          .filter((allocation) => !allocation.developmentId)
          .map((allocation) => allocation.amount),
      );
      const totalAllocatedCents = investmentAllocations.reduce(
        (sum, allocation) => sum + moneyToCents(allocation.amount),
        0,
      );
      const unassigned = centsToMoney(
        moneyToCents(investment.amount) - totalAllocatedCents,
      );
      const developments = Array.from(
        new Set(
          investmentAllocations
            .map((allocation) => allocation.development?.name)
            .filter((name): name is string => Boolean(name)),
        ),
      );

      return {
        date: formatIsoDate(investment.date),
        investor: investment.investor.name,
        document: investment.investor.document,
        totalAmount: investment.amount,
        type: investment.type,
        developmentAllocated,
        generalCash,
        unassigned,
        developments: developments.join(', ') || '—',
        notes: investment.notes ?? '—',
      };
    });

    return {
      title: 'Captação por período',
      sheetName: 'Captações',
      generatedAt,
      filters: this.periodFilters(query, references),
      columns: [
        dateColumn('date', 'Data do aporte', 14),
        textColumn('investor', 'Investidor', 22),
        textColumn('document', 'Documento', 16),
        currencyColumn('totalAmount', 'Valor total do aporte', 18),
        textColumn('type', 'Tipo de investimento', 17),
        currencyColumn(
          'developmentAllocated',
          'Destinado a empreendimentos',
          20,
        ),
        currencyColumn('generalCash', 'Caixa geral', 15),
        currencyColumn('unassigned', 'Saldo não alocado', 16),
        textColumn('developments', 'Empreendimentos', 28),
        textColumn('notes', 'Observações', 30),
      ],
      rows,
      summary: [
        {
          label: 'Total captado',
          value: sumMoney(investments.map((investment) => investment.amount)),
          kind: 'currency',
        },
        {
          label: 'Total destinado a empreendimentos',
          value: sumMoney(
            rows.map((row) => row.developmentAllocated as number),
          ),
          kind: 'currency',
        },
        {
          label: 'Total em caixa geral',
          value: sumMoney(rows.map((row) => row.generalCash as number)),
          kind: 'currency',
        },
        {
          label: 'Saldo não alocado',
          value: sumMoney(rows.map((row) => row.unassigned as number)),
          kind: 'currency',
        },
        {
          label: 'Número de aportes',
          value: investments.length,
          kind: 'number',
        },
        {
          label: 'Investidores únicos',
          value: new Set(
            investments.map((investment) => investment.investor.id),
          ).size,
          kind: 'number',
        },
      ],
    };
  }

  private async buildDevelopmentCaptationsReport(
    organizationId: string,
    query: CaptationsReportQueryDto,
    references: ReportReferences,
    generatedAt: Date,
    period: ReturnType<typeof getInclusiveReportPeriod>,
  ): Promise<ReportData> {
    const dateFilter = this.toDateFilter(period);
    const allocations = await this.prisma.allocation.findMany({
      where: {
        organizationId,
        developmentId: query.developmentId,
        investment: {
          organizationId,
          ...(query.investorId ? { investorId: query.investorId } : {}),
          ...(dateFilter ? { date: dateFilter } : {}),
        },
      },
      take: MAX_REPORT_ROWS + 1,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        date: true,
        notes: true,
        development: { select: { id: true, name: true } },
        investment: {
          select: {
            id: true,
            date: true,
            type: true,
            notes: true,
            investor: { select: { id: true, name: true, document: true } },
          },
        },
      },
    });
    this.assertWithinLimit(allocations.length, 'alocações de captação');

    const rows: ReportRow[] = allocations.map((allocation) => ({
      date: formatIsoDate(allocation.investment.date),
      investor: allocation.investment.investor.name,
      document: allocation.investment.investor.document,
      allocationAmount: allocation.amount,
      type: allocation.investment.type,
      development: allocation.development?.name ?? 'Empreendimento selecionado',
      notes: allocation.notes ?? allocation.investment.notes ?? '—',
    }));

    return {
      title: 'Captação por período — empreendimento selecionado',
      sheetName: 'Captação por empreendimento',
      generatedAt,
      filters: [
        ...this.periodFilters(query, references),
        {
          label: 'Escopo',
          value: 'Somente o valor das alocações no empreendimento selecionado',
        },
      ],
      columns: [
        dateColumn('date', 'Data do aporte', 14),
        textColumn('investor', 'Investidor', 22),
        textColumn('document', 'Documento', 16),
        currencyColumn('allocationAmount', 'Valor no empreendimento', 19),
        textColumn('type', 'Tipo de investimento', 17),
        textColumn('development', 'Empreendimento', 25),
        textColumn('notes', 'Observações', 32),
      ],
      rows,
      summary: [
        {
          label: 'Total captado no empreendimento',
          value: sumMoney(allocations.map((allocation) => allocation.amount)),
          kind: 'currency',
        },
        {
          label: 'Total destinado a empreendimentos',
          value: sumMoney(allocations.map((allocation) => allocation.amount)),
          kind: 'currency',
        },
        { label: 'Total em caixa geral no escopo', value: 0, kind: 'currency' },
        {
          label: 'Número de aportes',
          value: new Set(
            allocations.map((allocation) => allocation.investment.id),
          ).size,
          kind: 'number',
        },
        {
          label: 'Investidores únicos',
          value: new Set(
            allocations.map((allocation) => allocation.investment.investor.id),
          ).size,
          kind: 'number',
        },
      ],
    };
  }

  private returnSummary(
    returns: Array<{
      expectedAmount: number;
      realizedAmount: number | null;
      computedStatus: ReturnStatus;
    }>,
  ): ReportSummaryItem[] {
    const withStatus = (status: ReturnStatus) =>
      returns.filter((item) => item.computedStatus === status);
    const pending = withStatus(ReturnStatus.PENDENTE);
    const overdue = withStatus(ReturnStatus.ATRASADO);
    const paid = withStatus(ReturnStatus.PAGO);

    return [
      {
        label: 'Total previsto',
        value: sumMoney(returns.map((item) => item.expectedAmount)),
        kind: 'currency',
      },
      {
        label: 'Total realizado',
        value: sumMoney(paid.map((item) => item.realizedAmount)),
        kind: 'currency',
      },
      {
        label: 'Total pendente',
        value: sumMoney(pending.map((item) => item.expectedAmount)),
        kind: 'currency',
      },
      {
        label: 'Total atrasado',
        value: sumMoney(overdue.map((item) => item.expectedAmount)),
        kind: 'currency',
      },
      { label: 'Quantidade pendente', value: pending.length, kind: 'number' },
      { label: 'Quantidade paga', value: paid.length, kind: 'number' },
      { label: 'Quantidade atrasada', value: overdue.length, kind: 'number' },
    ];
  }

  private async validateReferences(
    organizationId: string,
    filters: { developmentId?: string; investorId?: string },
  ): Promise<ReportReferences> {
    const developmentPromise = filters.developmentId
      ? this.prisma.development.findFirst({
          where: { id: filters.developmentId, organizationId },
          select: { id: true, name: true },
        })
      : Promise.resolve(undefined);
    const investorPromise = filters.investorId
      ? this.prisma.person.findFirst({
          where: {
            id: filters.investorId,
            organizationId,
            roles: { some: { role: PersonRoleType.INVESTIDOR } },
          },
          select: { id: true, name: true },
        })
      : Promise.resolve(undefined);
    const [development, investor] = await Promise.all([
      developmentPromise,
      investorPromise,
    ]);

    if (filters.developmentId && !development) {
      throw new BadRequestException(
        'Empreendimento inválido para esta organização',
      );
    }
    if (filters.investorId && !investor) {
      throw new BadRequestException(
        'Investidor inválido para esta organização',
      );
    }

    return {
      ...(development ? { developmentName: development.name } : {}),
      ...(investor ? { investorName: investor.name } : {}),
    };
  }

  private toDateFilter(
    period: ReturnType<typeof getInclusiveReportPeriod>,
  ): Prisma.DateTimeFilter | undefined {
    if (!period.start && !period.endExclusive) return undefined;
    return {
      ...(period.start ? { gte: period.start } : {}),
      ...(period.endExclusive ? { lt: period.endExclusive } : {}),
    };
  }

  private toCalculatedStatusWhere(
    status: ReturnStatus | undefined,
    referenceDate: Date,
  ): Prisma.ReturnWhereInput | undefined {
    if (!status) return undefined;
    if (status === ReturnStatus.PAGO) return { status: ReturnStatus.PAGO };
    if (status === ReturnStatus.PENDENTE) {
      return {
        status: ReturnStatus.PENDENTE,
        expectedDate: { gte: referenceDate },
      };
    }

    return {
      OR: [
        { status: ReturnStatus.ATRASADO },
        {
          status: ReturnStatus.PENDENTE,
          expectedDate: { lt: referenceDate },
        },
      ],
    };
  }

  private periodFilters(
    query: {
      startDate?: string;
      endDate?: string;
      developmentId?: string;
      investorId?: string;
      status?: ReturnStatus;
    },
    references: ReportReferences,
  ): ReportFilter[] {
    const period =
      query.startDate || query.endDate
        ? `${query.startDate ?? 'início'} a ${query.endDate ?? 'hoje'}`
        : 'Todos os períodos';
    return [
      { label: 'Período (inclusivo)', value: period },
      ...this.referenceFilters(references),
      ...(query.status ? [{ label: 'Status', value: query.status }] : []),
    ];
  }

  private referenceFilters(references: ReportReferences): ReportFilter[] {
    return [
      ...(references.developmentName
        ? [{ label: 'Empreendimento', value: references.developmentName }]
        : []),
      ...(references.investorName
        ? [{ label: 'Investidor', value: references.investorName }]
        : []),
    ];
  }

  private createPositionAccumulator(investor: {
    id: string;
    name: string;
    document: string;
    email: string | null;
    phone: string | null;
  }): InvestorPositionAccumulator {
    return {
      id: investor.id,
      name: investor.name,
      document: investor.document,
      contact:
        [investor.email, investor.phone].filter(Boolean).join(' · ') || '—',
      totalInvestedCents: 0,
      developmentAllocatedCents: 0,
      generalCashCents: 0,
      unassignedCents: 0,
      expectedCents: 0,
      paidCents: 0,
      pendingCents: 0,
      overdueCents: 0,
      developmentNames: new Set<string>(),
    };
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private assertWithinLimit(count: number, subject: string): void {
    if (count > MAX_REPORT_ROWS) {
      throw new BadRequestException(
        `O relatório excede o limite de ${MAX_REPORT_ROWS.toLocaleString('pt-BR')} ${subject}. Refine os filtros e tente novamente.`,
      );
    }
  }

  private async export(
    report: ReportData,
    format: ReportFormat,
  ): Promise<GeneratedReport> {
    if (format === ReportFormat.XLSX) {
      return {
        buffer: await this.excelExporter.export(report),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
      };
    }

    return {
      buffer: await this.pdfExporter.export(report),
      contentType: 'application/pdf',
      extension: 'pdf',
    };
  }
}

function textColumn(key: string, label: string, width: number): ReportColumn {
  return { key, label, width, kind: 'text' };
}

function dateColumn(key: string, label: string, width: number): ReportColumn {
  return { key, label, width, kind: 'date' };
}

function currencyColumn(
  key: string,
  label: string,
  width: number,
): ReportColumn {
  return { key, label, width, kind: 'currency' };
}

function numberColumn(key: string, label: string, width: number): ReportColumn {
  return { key, label, width, kind: 'number' };
}
