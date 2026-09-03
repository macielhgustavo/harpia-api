import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankReconciliationStatus,
  FinancialCategoryType,
  FinancialTransactionType,
  PayableSourceType,
  PayableStatus,
  Prisma,
  ReturnStatus,
  SaleCommissionStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancelReceivableDto } from '../receivables/dto/cancel-receivable.dto';
import { RecordPaymentDto } from '../receivables/dto/record-payment.dto';
import { ReversePaymentDto } from '../receivables/dto/reverse-payment.dto';
import { startOfUtcDay } from '../receivables/receivable-status';
import { CreatePayableDto } from './dto/create-payable.dto';
import { ListPayablesQueryDto } from './dto/list-payables-query.dto';
import { MarkCommissionDueDto } from './dto/mark-commission-due.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { FinancialSetupService } from './financial-setup.service';
import { getComputedPayableStatus } from './payable-status';

interface FinanceActor {
  id: string;
  organizationId: string;
}

interface LockedPayable {
  id: string;
  organizationId: string;
  companyId: string | null;
  developmentId: string | null;
  costCenterId: string | null;
  sourceType: PayableSourceType | null;
  sourceId: string | null;
  description: string;
  originalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  status: PayableStatus;
  investorReturnId: string | null;
  saleCommissionId: string | null;
}

interface LockedPayment {
  id: string;
  amount: Prisma.Decimal;
  reversedAt: Date | null;
}

const PAYABLE_INCLUDE = {
  company: { select: { id: true, name: true, type: true } },
  development: { select: { id: true, name: true } },
  bankAccount: {
    select: { id: true, bank: true, agency: true, account: true },
  },
  category: { select: { id: true, name: true, type: true } },
  costCenter: { select: { id: true, name: true } },
  supplierPerson: { select: { id: true, name: true } },
  saleCommission: {
    select: {
      id: true,
      status: true,
      sale: { select: { id: true, saleNumber: true } },
      user: { select: { id: true, name: true } },
    },
  },
  investorReturn: {
    select: {
      id: true,
      allocation: {
        select: {
          investment: {
            select: { investor: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
  payments: {
    include: {
      bankAccount: {
        select: { id: true, bank: true, agency: true, account: true },
      },
      createdByUser: { select: { id: true, name: true } },
      reversedByUser: { select: { id: true, name: true } },
      transaction: { select: { id: true, reversedAt: true } },
    },
    orderBy: [{ paidAt: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.PayableInclude;

type PayableWithContext = Prisma.PayableGetPayload<{
  include: typeof PAYABLE_INCLUDE;
}>;

@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly setup: FinancialSetupService,
  ) {}

  async findAll(organizationId: string, query: ListPayablesQueryDto) {
    await this.setup.ensureOrganization(organizationId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(organizationId, query);
    const [data, total] = await Promise.all([
      this.prisma.payable.findMany({
        where,
        include: PAYABLE_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payable.count({ where }),
    ]);
    return {
      data: data.map((payable) => this.present(payable)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string, organizationId: string) {
    const payable = await this.prisma.payable.findFirst({
      where: { id, organizationId },
      include: PAYABLE_INCLUDE,
    });
    if (!payable) throw new NotFoundException('Conta a pagar não encontrada');
    return this.present(payable);
  }

  async create(actor: FinanceActor, dto: CreatePayableDto) {
    await this.setup.ensureOrganization(actor.organizationId);
    await this.assertReferences(actor.organizationId, dto);
    const payable = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payable.create({
        data: {
          organizationId: actor.organizationId,
          description: dto.description,
          dueDate: new Date(dto.dueDate),
          originalAmount: new Prisma.Decimal(dto.originalAmount),
          companyId: dto.companyId || null,
          developmentId: dto.developmentId || null,
          bankAccountId: dto.bankAccountId || null,
          categoryId: dto.categoryId || null,
          costCenterId: dto.costCenterId || null,
          supplierPersonId: dto.supplierPersonId || null,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PAYABLE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.PAYABLE,
          entityId: created.id,
        },
        tx,
      );
      return created;
    });
    return this.findOne(payable.id, actor.organizationId);
  }

  async update(id: string, actor: FinanceActor, dto: UpdatePayableDto) {
    const existing = await this.prisma.payable.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!existing) throw new NotFoundException('Conta a pagar não encontrada');
    if (existing.sourceType) {
      throw new ConflictException(
        'Lançamentos automáticos devem ser alterados na origem',
      );
    }
    await this.assertReferences(actor.organizationId, dto);
    const originalAmount = dto.originalAmount
      ? new Prisma.Decimal(dto.originalAmount)
      : existing.originalAmount;
    if (originalAmount.lessThan(existing.paidAmount)) {
      throw new BadRequestException(
        'O valor não pode ser menor que o total pago',
      );
    }
    if (
      existing.paidAmount.greaterThan(0) &&
      dto.originalAmount &&
      originalAmount.lessThanOrEqualTo(existing.paidAmount) &&
      !originalAmount.equals(existing.originalAmount)
    ) {
      throw new BadRequestException(
        'O novo valor deve permanecer maior que o total já pago',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payable.update({
        where: { id },
        data: {
          description: dto.description,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          originalAmount: dto.originalAmount,
          companyId: dto.companyId,
          developmentId: dto.developmentId,
          bankAccountId: dto.bankAccountId,
          categoryId: dto.categoryId,
          costCenterId: dto.costCenterId,
          supplierPersonId: dto.supplierPersonId,
          status: originalAmount.equals(existing.paidAmount)
            ? PayableStatus.PAGO
            : existing.paidAmount.greaterThan(0)
              ? PayableStatus.PARCIAL
              : PayableStatus.PENDENTE,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PAYABLE_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.PAYABLE,
          entityId: id,
          metadata: { changedFields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.findOne(id, actor.organizationId);
  }

  async recordPayment(id: string, actor: FinanceActor, dto: RecordPaymentDto) {
    const paidAt = new Date(dto.paidAt);
    if (paidAt.getTime() > Date.now()) {
      throw new BadRequestException(
        'A data do pagamento não pode estar no futuro',
      );
    }
    const amount = new Prisma.Decimal(dto.amount);
    await this.prisma.$transaction(async (tx) => {
      const payable = await this.lockPayable(tx, id, actor.organizationId);
      if (payable.status === PayableStatus.CANCELADO) {
        throw new ConflictException('A conta a pagar está cancelada');
      }
      if (payable.status === PayableStatus.PAGO) {
        throw new ConflictException('A conta a pagar já está paga');
      }
      const balance = payable.originalAmount.minus(payable.paidAmount);
      if (amount.greaterThan(balance)) {
        throw new BadRequestException('O pagamento não pode exceder o saldo');
      }
      const bankAccount = await this.requireBankAccount(
        tx,
        dto.bankAccountId,
        actor.organizationId,
      );
      const payment = await tx.financialPayment.create({
        data: {
          organizationId: actor.organizationId,
          payableId: payable.id,
          bankAccountId: bankAccount.id,
          amount,
          paidAt,
          notes: dto.notes || null,
          createdByUserId: actor.id,
        },
      });
      const transaction = await tx.financialTransaction.create({
        data: {
          organizationId: actor.organizationId,
          paymentId: payment.id,
          payableId: payable.id,
          bankAccountId: bankAccount.id,
          companyId: payable.companyId ?? bankAccount.companyId,
          developmentId: payable.developmentId,
          costCenterId: payable.costCenterId,
          type: FinancialTransactionType.SAIDA,
          amount,
          date: paidAt,
          description: payable.description,
        },
      });
      const paidAmount = payable.paidAmount.plus(amount);
      const status = paidAmount.equals(payable.originalAmount)
        ? PayableStatus.PAGO
        : PayableStatus.PARCIAL;
      await tx.payable.update({
        where: { id: payable.id },
        data: {
          paidAmount,
          status,
          paidAt: status === PayableStatus.PAGO ? paidAt : null,
          bankAccountId: bankAccount.id,
        },
      });
      await this.syncSource(tx, payable, status, paidAt, paidAmount);
      await this.audit.recordMany(
        [
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action:
              status === PayableStatus.PAGO
                ? AUDIT_ACTIONS.PAYABLE_PAID
                : AUDIT_ACTIONS.PAYMENT_CREATED,
            entityType: AUDIT_ENTITY_TYPES.PAYABLE,
            entityId: payable.id,
            metadata: { paymentId: payment.id, amount: amount.toFixed(2) },
          },
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.FINANCIAL_TRANSACTION_CREATED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_TRANSACTION,
            entityId: transaction.id,
            metadata: { payableId: payable.id, paymentId: payment.id },
          },
        ],
        tx,
      );
    });
    return this.findOne(id, actor.organizationId);
  }

  async reversePayment(
    id: string,
    paymentId: string,
    actor: FinanceActor,
    dto: ReversePaymentDto,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const payable = await this.lockPayable(tx, id, actor.organizationId);
      const payment = await this.lockPayment(
        tx,
        paymentId,
        payable.id,
        actor.organizationId,
      );
      if (payment.reversedAt)
        throw new ConflictException('Pagamento já estornado');
      const paidAmount = payable.paidAmount.minus(payment.amount);
      if (paidAmount.lessThan(0)) {
        throw new ConflictException('Histórico financeiro inconsistente');
      }
      const status = paidAmount.equals(0)
        ? PayableStatus.PENDENTE
        : PayableStatus.PARCIAL;
      const reversedAt = new Date();
      await tx.financialPayment.update({
        where: { id: payment.id },
        data: {
          reversedAt,
          reversedByUserId: actor.id,
          reversalReason: dto.reason,
        },
      });
      const transaction = await tx.financialTransaction.update({
        where: { paymentId: payment.id },
        data: { reversedAt },
      });
      const reconciliation = await tx.bankStatementEntry.updateMany({
        where: { matchedTransactionId: transaction.id },
        data: {
          status: BankReconciliationStatus.PENDENTE,
          matchedTransactionId: null,
          reconciledAt: null,
        },
      });
      await tx.payable.update({
        where: { id: payable.id },
        data: { paidAmount, status, paidAt: null },
      });
      await this.syncSource(tx, payable, status, reversedAt, paidAmount);
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PAYMENT_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_PAYMENT,
          entityId: payment.id,
          metadata: { payableId: payable.id, reason: dto.reason },
        },
        tx,
      );
      if (reconciliation.count) {
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.BANK_TRANSACTION_UNMATCHED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_TRANSACTION,
            entityId: transaction.id,
            metadata: { reason: 'PAYMENT_REVERSED' },
          },
          tx,
        );
      }
    });
    return this.findOne(id, actor.organizationId);
  }

  async cancel(id: string, actor: FinanceActor, dto: CancelReceivableDto) {
    await this.prisma.$transaction(async (tx) => {
      const payable = await this.lockPayable(tx, id, actor.organizationId);
      if (payable.sourceType) {
        throw new ConflictException(
          'Lançamentos automáticos devem ser cancelados na origem',
        );
      }
      if (!payable.paidAmount.equals(0)) {
        throw new ConflictException('Estorne os pagamentos antes de cancelar');
      }
      if (payable.status === PayableStatus.CANCELADO) return;
      await tx.payable.update({
        where: { id },
        data: { status: PayableStatus.CANCELADO, cancelledAt: new Date() },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PAYABLE_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.PAYABLE,
          entityId: id,
          metadata: { changedFields: ['status'], reason: dto.reason },
        },
        tx,
      );
    });
    return this.findOne(id, actor.organizationId);
  }

  async markCommissionDue(
    commissionId: string,
    actor: FinanceActor,
    dto: MarkCommissionDueDto,
  ) {
    const payableId = await this.prisma.$transaction(async (tx) => {
      const commission = await tx.saleCommission.findFirst({
        where: { id: commissionId, organizationId: actor.organizationId },
        include: {
          sale: {
            select: {
              id: true,
              saleNumber: true,
              developmentId: true,
              development: { select: { companyId: true } },
            },
          },
        },
      });
      if (!commission) throw new NotFoundException('Comissão não encontrada');
      if (
        commission.status === SaleCommissionStatus.PAGA ||
        commission.status === SaleCommissionStatus.CANCELADA
      ) {
        throw new ConflictException(
          'A comissão não pode ser marcada como devida',
        );
      }
      const category = await this.setup.expenseCategory(
        actor.organizationId,
        'Comissão',
        tx,
      );
      await tx.saleCommission.update({
        where: { id: commission.id },
        data: { status: SaleCommissionStatus.DEVIDA },
      });
      const payable = await tx.payable.upsert({
        where: { saleCommissionId: commission.id },
        update: {},
        create: {
          organizationId: actor.organizationId,
          companyId: commission.sale.development.companyId,
          developmentId: commission.sale.developmentId,
          categoryId: category.id,
          supplierPersonId: commission.personId,
          saleCommissionId: commission.id,
          description: `Comissão · venda ${commission.sale.saleNumber}`,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : new Date(),
          originalAmount: commission.amount,
          sourceType: PayableSourceType.SALE_COMMISSION,
          sourceId: commission.id,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.PAYABLE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.PAYABLE,
          entityId: payable.id,
          metadata: { saleCommissionId: commission.id },
        },
        tx,
      );
      return payable.id;
    });
    return this.findOne(payableId, actor.organizationId);
  }

  async createForInvestorReturn(
    returnId: string,
    actor: FinanceActor,
    tx: Prisma.TransactionClient,
  ) {
    const investorReturn = await tx.return.findFirst({
      where: { id: returnId, organizationId: actor.organizationId },
      include: {
        allocation: {
          select: {
            investment: {
              select: { investor: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (!investorReturn) throw new NotFoundException('Retorno não encontrado');
    const [category, costCenter] = await Promise.all([
      this.setup.expenseCategory(
        actor.organizationId,
        'Retorno de investidor',
        tx,
      ),
      this.setup.generalCostCenter(actor.organizationId, tx),
    ]);
    const payable = await tx.payable.upsert({
      where: { investorReturnId: investorReturn.id },
      update: {
        dueDate: investorReturn.expectedDate,
        originalAmount: new Prisma.Decimal(investorReturn.expectedAmount),
      },
      create: {
        organizationId: actor.organizationId,
        companyId: costCenter.companyId,
        categoryId: category.id,
        costCenterId: costCenter.id,
        supplierPersonId: investorReturn.allocation.investment.investor.id,
        investorReturnId: investorReturn.id,
        description: `Retorno de investidor · ${investorReturn.allocation.investment.investor.name}`,
        dueDate: investorReturn.expectedDate,
        originalAmount: new Prisma.Decimal(investorReturn.expectedAmount),
        sourceType: PayableSourceType.INVESTOR_RETURN,
        sourceId: investorReturn.id,
      },
    });
    await this.audit.record(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.PAYABLE_CREATED,
        entityType: AUDIT_ENTITY_TYPES.PAYABLE,
        entityId: payable.id,
        metadata: { investorReturnId: investorReturn.id },
      },
      tx,
    );
    return payable;
  }

  async syncInvestorReturnTerms(
    returnId: string,
    organizationId: string,
    expectedAmount: number,
    expectedDate: Date,
    tx: Prisma.TransactionClient,
  ) {
    const payable = await tx.payable.findFirst({
      where: { investorReturnId: returnId, organizationId },
    });
    if (!payable) return;
    if (payable.paidAmount.greaterThan(0)) {
      throw new ConflictException(
        'Estorne o pagamento financeiro antes de alterar o retorno',
      );
    }
    await tx.payable.update({
      where: { id: payable.id },
      data: {
        originalAmount: new Prisma.Decimal(expectedAmount),
        dueDate: expectedDate,
      },
    });
  }

  private buildWhere(
    organizationId: string,
    query: ListPayablesQueryDto,
  ): Prisma.PayableWhereInput {
    const today = startOfUtcDay();
    const where: Prisma.PayableWhereInput = {
      organizationId,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.developmentId ? { developmentId: query.developmentId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
      ...(query.supplierPersonId
        ? { supplierPersonId: query.supplierPersonId }
        : {}),
    };
    if (query.status === 'ATRASADO') {
      where.status = { in: [PayableStatus.PENDENTE, PayableStatus.PARCIAL] };
      where.dueDate = { lt: today };
    } else if (query.status === 'PENDENTE') {
      where.status = PayableStatus.PENDENTE;
      where.dueDate = { gte: today };
    } else if (query.status === 'PARCIAL') {
      where.status = PayableStatus.PARCIAL;
      where.dueDate = { gte: today };
    } else if (query.status) {
      where.status = query.status as PayableStatus;
    }
    if (query.startDate || query.endDate) {
      const start = query.startDate
        ? new Date(`${query.startDate}T00:00:00.000Z`)
        : undefined;
      const end = query.endDate
        ? new Date(`${query.endDate}T00:00:00.000Z`)
        : undefined;
      if (end) end.setUTCDate(end.getUTCDate() + 1);
      if (start && end && start >= end) {
        throw new BadRequestException('Período inválido');
      }
      where.dueDate = {
        ...(typeof where.dueDate === 'object' ? where.dueDate : {}),
        ...(start ? { gte: start } : {}),
        ...(end ? { lt: end } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        {
          supplierPerson: {
            name: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }
    return where;
  }

  private present(payable: PayableWithContext) {
    return {
      ...payable,
      status: getComputedPayableStatus(payable.status, payable.dueDate),
      persistedStatus: payable.status,
      balance: payable.originalAmount.minus(payable.paidAmount),
      recipient:
        payable.supplierPerson?.name ??
        payable.investorReturn?.allocation.investment.investor.name ??
        payable.saleCommission?.user?.name ??
        'Não informado',
    };
  }

  private async assertReferences(
    organizationId: string,
    dto: Partial<CreatePayableDto>,
  ) {
    const [company, development, bankAccount, category, costCenter, supplier] =
      await Promise.all([
        dto.companyId
          ? this.prisma.company.findFirst({
              where: { id: dto.companyId, organizationId },
            })
          : null,
        dto.developmentId
          ? this.prisma.development.findFirst({
              where: { id: dto.developmentId, organizationId },
            })
          : null,
        dto.bankAccountId
          ? this.prisma.bankAccount.findFirst({
              where: { id: dto.bankAccountId, organizationId },
            })
          : null,
        dto.categoryId
          ? this.prisma.financialCategory.findFirst({
              where: { id: dto.categoryId, organizationId },
            })
          : null,
        dto.costCenterId
          ? this.prisma.costCenter.findFirst({
              where: { id: dto.costCenterId, organizationId },
            })
          : null,
        dto.supplierPersonId
          ? this.prisma.person.findFirst({
              where: { id: dto.supplierPersonId, organizationId },
            })
          : null,
      ]);
    if (dto.companyId && !company)
      throw new BadRequestException('Empresa inválida');
    if (dto.developmentId && !development) {
      throw new BadRequestException('Empreendimento inválido');
    }
    if (
      dto.companyId &&
      development?.companyId &&
      development.companyId !== dto.companyId
    ) {
      throw new BadRequestException('Empreendimento não pertence à empresa');
    }
    if (dto.bankAccountId && !bankAccount) {
      throw new BadRequestException('Conta bancária inválida');
    }
    if (dto.categoryId && !category) {
      throw new BadRequestException('Categoria inválida');
    }
    if (category && category.type !== FinancialCategoryType.DESPESA) {
      throw new BadRequestException('A categoria deve ser de despesa');
    }
    if (dto.costCenterId && !costCenter) {
      throw new BadRequestException('Centro de custo inválido');
    }
    if (dto.supplierPersonId && !supplier) {
      throw new BadRequestException('Fornecedor inválido');
    }
  }

  private async requireBankAccount(
    tx: Prisma.TransactionClient,
    bankAccountId: string,
    organizationId: string,
  ) {
    const account = await tx.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
      select: { id: true, companyId: true },
    });
    if (!account) throw new BadRequestException('Conta bancária inválida');
    return account;
  }

  private async lockPayable(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [payable] = await tx.$queryRaw<LockedPayable[]>`
      SELECT "id", "organizationId", "companyId", "developmentId",
        "costCenterId", "sourceType", "sourceId", "description",
        "originalAmount", "paidAmount", "status", "investorReturnId",
        "saleCommissionId"
      FROM "Payable"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!payable) throw new NotFoundException('Conta a pagar não encontrada');
    return payable;
  }

  private async lockPayment(
    tx: Prisma.TransactionClient,
    id: string,
    payableId: string,
    organizationId: string,
  ) {
    const [payment] = await tx.$queryRaw<LockedPayment[]>`
      SELECT "id", "amount", "reversedAt"
      FROM "FinancialPayment"
      WHERE "id" = ${id} AND "payableId" = ${payableId}
        AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    return payment;
  }

  private async syncSource(
    tx: Prisma.TransactionClient,
    payable: LockedPayable,
    status: PayableStatus,
    date: Date,
    paidAmount: Prisma.Decimal,
  ) {
    if (payable.investorReturnId) {
      await tx.return.update({
        where: { id: payable.investorReturnId },
        data:
          status === PayableStatus.PAGO
            ? {
                status: ReturnStatus.PAGO,
                realizedDate: date,
                realizedAmount: Number(paidAmount.toFixed(2)),
              }
            : {
                status: ReturnStatus.PENDENTE,
                realizedDate: null,
                realizedAmount: null,
              },
      });
    }
    if (payable.saleCommissionId) {
      await tx.saleCommission.update({
        where: { id: payable.saleCommissionId },
        data: {
          status:
            status === PayableStatus.PAGO
              ? SaleCommissionStatus.PAGA
              : SaleCommissionStatus.DEVIDA,
        },
      });
    }
  }
}
