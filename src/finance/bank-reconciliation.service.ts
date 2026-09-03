import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankReconciliationStatus,
  BankStatementEntryType,
  FinancialTransactionType,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { PrismaService } from '../prisma/prisma.service';
import { ImportBankStatementDto } from './dto/import-bank-statement.dto';
import { ListReconciliationQueryDto } from './dto/list-reconciliation-query.dto';

interface FinanceActor {
  id: string;
  organizationId: string;
}

interface LockedEntry {
  id: string;
  bankAccountId: string;
  type: BankStatementEntryType;
  amount: Prisma.Decimal;
  status: BankReconciliationStatus;
  matchedTransactionId: string | null;
}

interface LockedTransaction {
  id: string;
  bankAccountId: string;
  type: FinancialTransactionType;
  amount: Prisma.Decimal;
  reversedAt: Date | null;
}

const ENTRY_INCLUDE = {
  bankAccount: {
    select: { id: true, bank: true, agency: true, account: true },
  },
  matchedTransaction: {
    select: {
      id: true,
      type: true,
      amount: true,
      date: true,
      description: true,
      reversedAt: true,
    },
  },
} as const satisfies Prisma.BankStatementEntryInclude;

@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: ListReconciliationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const date = this.dateRange(query.startDate, query.endDate);
    const where: Prisma.BankStatementEntryWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(date ? { date } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                description: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                externalId: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const baseWhere: Prisma.BankStatementEntryWhereInput = {
      organizationId,
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(date ? { date } : {}),
    };
    const [data, total, pending, reconciled, ignored] = await Promise.all([
      this.prisma.bankStatementEntry.findMany({
        where,
        include: ENTRY_INCLUDE,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.bankStatementEntry.count({ where }),
      this.summaryFor(baseWhere, BankReconciliationStatus.PENDENTE),
      this.summaryFor(baseWhere, BankReconciliationStatus.CONCILIADO),
      this.summaryFor(baseWhere, BankReconciliationStatus.IGNORADO),
    ]);
    return {
      data,
      summary: { pending, reconciled, ignored },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async import(actor: FinanceActor, dto: ImportBankStatementDto) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!account) throw new BadRequestException('Conta bancária inválida');

    const data = dto.entries.map((entry) => ({
      organizationId: actor.organizationId,
      bankAccountId: account.id,
      externalId: entry.externalId || null,
      fingerprint: this.fingerprint(account.id, entry),
      date: new Date(`${entry.date}T12:00:00.000Z`),
      description: entry.description,
      type: entry.type,
      amount: new Prisma.Decimal(entry.amount),
    }));

    const imported = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bankStatementEntry.createMany({
        data,
        skipDuplicates: true,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.BANK_STATEMENT_IMPORTED,
          entityType: AUDIT_ENTITY_TYPES.BANK_STATEMENT_ENTRY,
          metadata: {
            bankAccountId: account.id,
            received: data.length,
            imported: result.count,
            skipped: data.length - result.count,
          },
        },
        tx,
      );
      return result.count;
    });
    return { received: data.length, imported, skipped: data.length - imported };
  }

  async candidates(id: string, organizationId: string) {
    const entry = await this.findOne(id, organizationId);
    if (entry.status !== BankReconciliationStatus.PENDENTE) return [];
    const start = new Date(entry.date);
    const end = new Date(entry.date);
    start.setUTCDate(start.getUTCDate() - 3);
    end.setUTCDate(end.getUTCDate() + 4);
    const type =
      entry.type === BankStatementEntryType.CREDITO
        ? FinancialTransactionType.ENTRADA
        : FinancialTransactionType.SAIDA;
    const candidates = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        bankAccountId: entry.bankAccountId,
        type,
        amount: entry.amount,
        reversedAt: null,
        statementEntry: null,
        date: { gte: start, lt: end },
      },
      select: {
        id: true,
        type: true,
        amount: true,
        date: true,
        description: true,
        receivable: { select: { id: true, description: true } },
        payable: { select: { id: true, description: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    return candidates
      .map((candidate) => ({
        ...candidate,
        score: this.candidateScore(entry.date, candidate.date),
      }))
      .sort((left, right) => right.score - left.score);
  }

  async match(id: string, transactionId: string, actor: FinanceActor) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const entry = await this.lockEntry(tx, id, actor.organizationId);
        if (entry.status !== BankReconciliationStatus.PENDENTE) {
          throw new ConflictException('O lançamento não está pendente');
        }
        const transaction = await this.lockTransaction(
          tx,
          transactionId,
          actor.organizationId,
        );
        const expectedType =
          entry.type === BankStatementEntryType.CREDITO
            ? FinancialTransactionType.ENTRADA
            : FinancialTransactionType.SAIDA;
        if (
          transaction.reversedAt ||
          transaction.bankAccountId !== entry.bankAccountId ||
          transaction.type !== expectedType ||
          !transaction.amount.equals(entry.amount)
        ) {
          throw new BadRequestException(
            'A transação não corresponde à conta, natureza e valor do extrato',
          );
        }
        const alreadyMatched = await tx.bankStatementEntry.findFirst({
          where: { matchedTransactionId: transaction.id },
          select: { id: true },
        });
        if (alreadyMatched) {
          throw new ConflictException('A transação já foi conciliada');
        }
        await tx.bankStatementEntry.update({
          where: { id: entry.id },
          data: {
            status: BankReconciliationStatus.CONCILIADO,
            matchedTransactionId: transaction.id,
            reconciledAt: new Date(),
            ignoredAt: null,
          },
        });
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.BANK_TRANSACTION_MATCHED,
            entityType: AUDIT_ENTITY_TYPES.BANK_STATEMENT_ENTRY,
            entityId: entry.id,
            metadata: { transactionId: transaction.id },
          },
          tx,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A transação já foi conciliada');
      }
      throw error;
    }
    return this.findOne(id, actor.organizationId);
  }

  async unmatch(id: string, actor: FinanceActor) {
    await this.changeStatus(
      id,
      actor,
      BankReconciliationStatus.CONCILIADO,
      BankReconciliationStatus.PENDENTE,
      AUDIT_ACTIONS.BANK_TRANSACTION_UNMATCHED,
    );
    return this.findOne(id, actor.organizationId);
  }

  async ignore(id: string, actor: FinanceActor) {
    await this.changeStatus(
      id,
      actor,
      BankReconciliationStatus.PENDENTE,
      BankReconciliationStatus.IGNORADO,
      AUDIT_ACTIONS.BANK_STATEMENT_IGNORED,
    );
    return this.findOne(id, actor.organizationId);
  }

  async restore(id: string, actor: FinanceActor) {
    await this.changeStatus(
      id,
      actor,
      BankReconciliationStatus.IGNORADO,
      BankReconciliationStatus.PENDENTE,
      AUDIT_ACTIONS.BANK_STATEMENT_RESTORED,
    );
    return this.findOne(id, actor.organizationId);
  }

  private findOne(id: string, organizationId: string) {
    return this.prisma.bankStatementEntry
      .findFirst({ where: { id, organizationId }, include: ENTRY_INCLUDE })
      .then((entry) => {
        if (!entry)
          throw new NotFoundException('Lançamento de extrato não encontrado');
        return entry;
      });
  }

  private async changeStatus(
    id: string,
    actor: FinanceActor,
    expected: BankReconciliationStatus,
    target: BankReconciliationStatus,
    action: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const entry = await this.lockEntry(tx, id, actor.organizationId);
      if (entry.status !== expected) {
        throw new ConflictException(
          'O lançamento foi alterado por outro usuário',
        );
      }
      await tx.bankStatementEntry.update({
        where: { id: entry.id },
        data: {
          status: target,
          matchedTransactionId: null,
          reconciledAt: null,
          ignoredAt:
            target === BankReconciliationStatus.IGNORADO ? new Date() : null,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action,
          entityType: AUDIT_ENTITY_TYPES.BANK_STATEMENT_ENTRY,
          entityId: entry.id,
        },
        tx,
      );
    });
  }

  private async lockEntry(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [entry] = await tx.$queryRaw<LockedEntry[]>`
      SELECT "id", "bankAccountId", "type", "amount", "status", "matchedTransactionId"
      FROM "BankStatementEntry"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!entry)
      throw new NotFoundException('Lançamento de extrato não encontrado');
    return entry;
  }

  private async lockTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [transaction] = await tx.$queryRaw<LockedTransaction[]>`
      SELECT "id", "bankAccountId", "type", "amount", "reversedAt"
      FROM "FinancialTransaction"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!transaction)
      throw new NotFoundException('Transação financeira não encontrada');
    return transaction;
  }

  private summaryFor(
    baseWhere: Prisma.BankStatementEntryWhereInput,
    status: BankReconciliationStatus,
  ) {
    return this.prisma.bankStatementEntry
      .aggregate({
        where: { ...baseWhere, status },
        _count: { _all: true },
        _sum: { amount: true },
      })
      .then((result) => ({
        count: result._count._all,
        amount: (result._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      }));
  }

  private dateRange(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return undefined;
    const start = startDate
      ? new Date(`${startDate}T00:00:00.000Z`)
      : undefined;
    const end = endDate ? new Date(`${endDate}T00:00:00.000Z`) : undefined;
    if (start && end && start > end) {
      throw new BadRequestException(
        'startDate deve ser anterior ou igual a endDate',
      );
    }
    if (end) end.setUTCDate(end.getUTCDate() + 1);
    return { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };
  }

  private fingerprint(
    bankAccountId: string,
    entry: ImportBankStatementDto['entries'][number],
  ) {
    const identity = entry.externalId
      ? `external:${entry.externalId.trim()}`
      : [
          entry.date,
          entry.type,
          new Prisma.Decimal(entry.amount).toFixed(2),
          entry.description.trim().toLocaleLowerCase('pt-BR'),
        ].join('|');
    return createHash('sha256')
      .update(`${bankAccountId}|${identity}`)
      .digest('hex');
  }

  private candidateScore(statementDate: Date, transactionDate: Date) {
    const days = Math.abs(
      Math.round(
        (statementDate.getTime() - transactionDate.getTime()) / 86_400_000,
      ),
    );
    return Math.max(70, 100 - days * 10);
  }
}
