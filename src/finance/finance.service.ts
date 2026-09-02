import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FinancialTransactionType,
  PayableStatus,
  Prisma,
  ReceivableStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfUtcDay } from '../receivables/receivable-status';
import { FinanceQueryDto } from './dto/finance-query.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { FinancialSetupService } from './financial-setup.service';

interface FlowEvent {
  date: Date;
  type: FinancialTransactionType;
  amount: Prisma.Decimal;
  realized: boolean;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinancialSetupService,
  ) {}

  async summary(organizationId: string, query: FinanceQueryDto) {
    await this.setup.ensureOrganization(organizationId);
    const now = new Date();
    const today = startOfUtcDay(now);
    const nextThirtyDays = new Date(today);
    nextThirtyDays.setUTCDate(nextThirtyDays.getUTCDate() + 30);
    const transactionWhere = this.transactionWhere(organizationId, query);
    const receivableWhere = this.receivableWhere(organizationId, query);
    const payableWhere = this.payableWhere(organizationId, query);
    const [transactions, receivables, payables, companies] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where: { ...transactionWhere, reversedAt: null },
        select: { type: true, amount: true },
      }),
      this.prisma.receivable.findMany({
        where: {
          ...receivableWhere,
          status: { not: ReceivableStatus.CANCELADO },
        },
        select: {
          id: true,
          description: true,
          dueDate: true,
          adjustedAmount: true,
          paidAmount: true,
          status: true,
          companyId: true,
          sale: {
            select: {
              saleNumber: true,
              buyers: {
                where: { isPrimary: true },
                select: { person: { select: { name: true } } },
                take: 1,
              },
            },
          },
        },
      }),
      this.prisma.payable.findMany({
        where: { ...payableWhere, status: { not: PayableStatus.CANCELADO } },
        select: {
          id: true,
          description: true,
          dueDate: true,
          originalAmount: true,
          paidAmount: true,
          status: true,
          companyId: true,
          supplierPerson: { select: { name: true } },
        },
      }),
      this.prisma.company.findMany({
        where: { organizationId },
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const zero = new Prisma.Decimal(0);
    const cashBalance = transactions.reduce(
      (sum, transaction) =>
        transaction.type === FinancialTransactionType.ENTRADA
          ? sum.plus(transaction.amount)
          : sum.minus(transaction.amount),
      zero,
    );
    const receivableBalance = (item: (typeof receivables)[number]) =>
      item.adjustedAmount.minus(item.paidAmount);
    const payableBalance = (item: (typeof payables)[number]) =>
      item.originalAmount.minus(item.paidAmount);
    const receivablesPending = receivables.reduce(
      (sum, item) => sum.plus(receivableBalance(item)),
      zero,
    );
    const payablesPending = payables.reduce(
      (sum, item) => sum.plus(payableBalance(item)),
      zero,
    );
    const receivablesOverdue = receivables.reduce(
      (sum, item) =>
        item.dueDate < today &&
        (item.status === ReceivableStatus.PENDENTE ||
          item.status === ReceivableStatus.PARCIAL)
          ? sum.plus(receivableBalance(item))
          : sum,
      zero,
    );
    const payablesOverdue = payables.reduce(
      (sum, item) =>
        item.dueDate < today &&
        (item.status === PayableStatus.PENDENTE ||
          item.status === PayableStatus.PARCIAL)
          ? sum.plus(payableBalance(item))
          : sum,
      zero,
    );
    const expectedInflows30d = receivables.reduce(
      (sum, item) =>
        item.dueDate >= today && item.dueDate < nextThirtyDays
          ? sum.plus(receivableBalance(item))
          : sum,
      zero,
    );
    const expectedOutflows30d = payables.reduce(
      (sum, item) =>
        item.dueDate >= today && item.dueDate < nextThirtyDays
          ? sum.plus(payableBalance(item))
          : sum,
      zero,
    );
    const positionByCompany = companies.map((company) => {
      const inflows = receivables
        .filter(({ companyId }) => companyId === company.id)
        .reduce((sum, item) => sum.plus(receivableBalance(item)), zero);
      const outflows = payables
        .filter(({ companyId }) => companyId === company.id)
        .reduce((sum, item) => sum.plus(payableBalance(item)), zero);
      return {
        ...company,
        receivables: inflows.toFixed(2),
        payables: outflows.toFixed(2),
        projectedPosition: inflows.minus(outflows).toFixed(2),
      };
    });
    const upcoming = [
      ...receivables.map((item) => ({
        id: item.id,
        kind: 'RECEIVABLE' as const,
        description: item.description,
        counterparty:
          item.sale?.buyers[0]?.person.name ?? item.sale?.saleNumber ?? '',
        dueDate: item.dueDate,
        amount: receivableBalance(item).toFixed(2),
      })),
      ...payables.map((item) => ({
        id: item.id,
        kind: 'PAYABLE' as const,
        description: item.description,
        counterparty: item.supplierPerson?.name ?? '',
        dueDate: item.dueDate,
        amount: payableBalance(item).toFixed(2),
      })),
    ]
      .filter(({ dueDate }) => dueDate >= today)
      .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())
      .slice(0, 10);

    return {
      cashBalance: cashBalance.toFixed(2),
      receivablesPending: receivablesPending.toFixed(2),
      receivablesOverdue: receivablesOverdue.toFixed(2),
      payablesPending: payablesPending.toFixed(2),
      payablesOverdue: payablesOverdue.toFixed(2),
      expectedInflows30d: expectedInflows30d.toFixed(2),
      expectedOutflows30d: expectedOutflows30d.toFixed(2),
      projected30d: expectedInflows30d.minus(expectedOutflows30d).toFixed(2),
      positionByCompany,
      upcoming,
    };
  }

  async transactions(organizationId: string, query: ListTransactionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const date = this.optionalDateRange(query.startDate, query.endDate);
    const where: Prisma.FinancialTransactionWhereInput = {
      organizationId,
      reversedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.developmentId ? { developmentId: query.developmentId } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(date ? { date } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where,
        include: {
          bankAccount: {
            select: { id: true, bank: true, agency: true, account: true },
          },
          company: { select: { id: true, name: true } },
          development: { select: { id: true, name: true } },
          costCenter: { select: { id: true, name: true } },
          receivable: { select: { id: true, description: true } },
          payable: { select: { id: true, description: true } },
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.financialTransaction.count({ where }),
    ]);
    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async cashFlow(organizationId: string, query: FinanceQueryDto) {
    await this.setup.ensureOrganization(organizationId);
    const mode = query.mode ?? 'CONSOLIDADO';
    const groupBy = query.groupBy ?? 'DIA';
    const { start, end } = this.range(query);
    const events: FlowEvent[] = [];
    const transactionWhere = this.transactionWhere(organizationId, query);

    if (mode !== 'PROJETADO') {
      const transactions = await this.prisma.financialTransaction.findMany({
        where: {
          ...transactionWhere,
          reversedAt: null,
          date: { gte: start, lt: end },
        },
        select: { date: true, type: true, amount: true },
      });
      events.push(...transactions.map((item) => ({ ...item, realized: true })));
    }
    if (mode !== 'REALIZADO') {
      const [receivables, payables] = await Promise.all([
        this.prisma.receivable.findMany({
          where: {
            ...this.receivableWhere(organizationId, query),
            status: {
              in: [ReceivableStatus.PENDENTE, ReceivableStatus.PARCIAL],
            },
            dueDate: { gte: start, lt: end },
          },
          select: {
            dueDate: true,
            adjustedAmount: true,
            paidAmount: true,
          },
        }),
        this.prisma.payable.findMany({
          where: {
            ...this.payableWhere(organizationId, query),
            status: { in: [PayableStatus.PENDENTE, PayableStatus.PARCIAL] },
            dueDate: { gte: start, lt: end },
          },
          select: { dueDate: true, originalAmount: true, paidAmount: true },
        }),
      ]);
      events.push(
        ...receivables.map((item) => ({
          date: item.dueDate,
          type: FinancialTransactionType.ENTRADA,
          amount: item.adjustedAmount.minus(item.paidAmount),
          realized: false,
        })),
        ...payables.map((item) => ({
          date: item.dueDate,
          type: FinancialTransactionType.SAIDA,
          amount: item.originalAmount.minus(item.paidAmount),
          realized: false,
        })),
      );
    }

    const openingBalance =
      mode === 'PROJETADO'
        ? new Prisma.Decimal(0)
        : await this.openingBalance(transactionWhere, start);
    const grouped = new Map<
      string,
      {
        date: string;
        inflows: Prisma.Decimal;
        outflows: Prisma.Decimal;
        realizedInflows: Prisma.Decimal;
        realizedOutflows: Prisma.Decimal;
        projectedInflows: Prisma.Decimal;
        projectedOutflows: Prisma.Decimal;
      }
    >();
    for (const event of events) {
      const date = this.bucket(event.date, groupBy);
      const row = grouped.get(date) ?? {
        date,
        inflows: new Prisma.Decimal(0),
        outflows: new Prisma.Decimal(0),
        realizedInflows: new Prisma.Decimal(0),
        realizedOutflows: new Prisma.Decimal(0),
        projectedInflows: new Prisma.Decimal(0),
        projectedOutflows: new Prisma.Decimal(0),
      };
      if (event.type === FinancialTransactionType.ENTRADA) {
        row.inflows = row.inflows.plus(event.amount);
        row[event.realized ? 'realizedInflows' : 'projectedInflows'] = row[
          event.realized ? 'realizedInflows' : 'projectedInflows'
        ].plus(event.amount);
      } else {
        row.outflows = row.outflows.plus(event.amount);
        row[event.realized ? 'realizedOutflows' : 'projectedOutflows'] = row[
          event.realized ? 'realizedOutflows' : 'projectedOutflows'
        ].plus(event.amount);
      }
      grouped.set(date, row);
    }
    let balance = openingBalance;
    const data = [...grouped.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((row) => {
        balance = balance.plus(row.inflows).minus(row.outflows);
        return {
          date: row.date,
          inflows: row.inflows.toFixed(2),
          outflows: row.outflows.toFixed(2),
          net: row.inflows.minus(row.outflows).toFixed(2),
          balance: balance.toFixed(2),
          realizedInflows: row.realizedInflows.toFixed(2),
          realizedOutflows: row.realizedOutflows.toFixed(2),
          projectedInflows: row.projectedInflows.toFixed(2),
          projectedOutflows: row.projectedOutflows.toFixed(2),
        };
      });
    return {
      mode,
      groupBy,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      openingBalance: openingBalance.toFixed(2),
      closingBalance: balance.toFixed(2),
      data,
    };
  }

  private transactionWhere(
    organizationId: string,
    query: FinanceQueryDto,
  ): Prisma.FinancialTransactionWhereInput {
    return {
      organizationId,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.developmentId ? { developmentId: query.developmentId } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
    };
  }

  private receivableWhere(
    organizationId: string,
    query: FinanceQueryDto,
  ): Prisma.ReceivableWhereInput {
    return {
      organizationId,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.developmentId
        ? { sale: { developmentId: query.developmentId } }
        : {}),
      ...(query.costCenterId
        ? {
            OR: [
              {
                company: { costCenters: { some: { id: query.costCenterId } } },
              },
              {
                sale: {
                  development: {
                    costCenters: { some: { id: query.costCenterId } },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private payableWhere(
    organizationId: string,
    query: FinanceQueryDto,
  ): Prisma.PayableWhereInput {
    return {
      organizationId,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.developmentId ? { developmentId: query.developmentId } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
    };
  }

  private range(query: FinanceQueryDto) {
    const today = startOfUtcDay();
    const start = query.startDate
      ? new Date(`${query.startDate}T00:00:00.000Z`)
      : new Date(today.getTime() - 30 * 86_400_000);
    const end = query.endDate
      ? new Date(`${query.endDate}T00:00:00.000Z`)
      : new Date(today.getTime() + (query.days ?? 90) * 86_400_000);
    if (query.endDate) end.setUTCDate(end.getUTCDate() + 1);
    if (start >= end) throw new BadRequestException('Período inválido');
    return { start, end };
  }

  private async openingBalance(
    where: Prisma.FinancialTransactionWhereInput,
    start: Date,
  ) {
    const transactions = await this.prisma.financialTransaction.findMany({
      where: { ...where, reversedAt: null, date: { lt: start } },
      select: { type: true, amount: true },
    });
    return transactions.reduce(
      (sum, item) =>
        item.type === FinancialTransactionType.ENTRADA
          ? sum.plus(item.amount)
          : sum.minus(item.amount),
      new Prisma.Decimal(0),
    );
  }

  private bucket(date: Date, groupBy: 'DIA' | 'SEMANA' | 'MES') {
    const bucket = startOfUtcDay(date);
    if (groupBy === 'MES') bucket.setUTCDate(1);
    if (groupBy === 'SEMANA') {
      const day = bucket.getUTCDay() || 7;
      bucket.setUTCDate(bucket.getUTCDate() - day + 1);
    }
    return bucket.toISOString().slice(0, 10);
  }

  private optionalDateRange(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return undefined;
    const start = startDate
      ? new Date(`${startDate}T00:00:00.000Z`)
      : undefined;
    const end = endDate ? new Date(`${endDate}T00:00:00.000Z`) : undefined;
    if (end) end.setUTCDate(end.getUTCDate() + 1);
    if (start && end && start >= end) {
      throw new BadRequestException('Período inválido');
    }
    return {
      ...(start ? { gte: start } : {}),
      ...(end ? { lt: end } : {}),
    };
  }
}
