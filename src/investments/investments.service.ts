import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PersonRoleType, Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { UpdateInvestmentDto } from './dto/update-investment.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

const INVESTMENT_UPDATE_FIELDS: (keyof UpdateInvestmentDto)[] = [
  'amount',
  'date',
  'type',
  'notes',
];

// Investment com allocations incluídas + nome do development de cada uma.
type InvestmentWithAllocations = Prisma.InvestmentGetPayload<{
  include: {
    investor: { select: { id: true; name: true } };
    allocations: {
      include: { development: { select: { id: true; name: true } } };
    };
  };
}>;

@Injectable()
export class InvestmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: string, investorId?: string) {
    const where: Prisma.InvestmentWhereInput = { organizationId };
    if (investorId) where.investorId = investorId;

    const investments = await this.prisma.investment.findMany({
      where,
      include: {
        investor: { select: { id: true, name: true } },
        allocations: {
          include: { development: { select: { id: true, name: true } } },
        },
      },
      orderBy: { date: 'desc' },
    });

    return investments.map((i) => this.withComputedAmounts(i));
  }

  async findOne(id: string, organizationId: string) {
    const investment = await this.prisma.investment.findFirst({
      where: { id, organizationId },
      include: {
        investor: { select: { id: true, name: true } },
        allocations: {
          include: {
            development: { select: { id: true, name: true } },
            returns: true,
          },
        },
      },
    });
    if (!investment) throw new NotFoundException('Aporte não encontrado');

    const allocatedAmount = this.sumAllocatedToDevelopment(
      investment.allocations,
    );
    return {
      ...investment,
      allocatedAmount,
      unallocatedAmount: investment.amount - allocatedAmount,
    };
  }

  async create(actor: MutationActor, dto: CreateInvestmentDto) {
    await this.assertInvestor(dto.investorId, actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const investment = await tx.investment.create({
        data: {
          organizationId: actor.organizationId,
          investorId: dto.investorId,
          amount: dto.amount,
          date: new Date(dto.date),
          type: dto.type,
          notes: dto.notes,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.INVESTMENT,
          entityId: investment.id,
        },
        tx,
      );
      return investment;
    });
  }

  async update(id: string, actor: MutationActor, dto: UpdateInvestmentDto) {
    const investment = await this.prisma.investment.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { allocations: { select: { amount: true } } },
    });
    if (!investment) throw new NotFoundException('Aporte não encontrado');

    // Reduzir o valor total abaixo do já alocado deixaria as alocações inconsistentes.
    if (dto.amount != null) {
      const allocated = investment.allocations.reduce(
        (sum, a) => sum + a.amount,
        0,
      );
      if (dto.amount < allocated) {
        throw new BadRequestException(
          `Valor do aporte não pode ser menor que o total já alocado (R$ ${allocated})`,
        );
      }
    }

    const changedFields = INVESTMENT_UPDATE_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    return this.prisma.$transaction(async (tx) => {
      const updatedInvestment = await tx.investment.update({
        where: { id },
        data: {
          amount: dto.amount,
          date: dto.date ? new Date(dto.date) : undefined,
          type: dto.type,
          notes: dto.notes,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.INVESTMENT,
          entityId: updatedInvestment.id,
          metadata: { changedFields },
        },
        tx,
      );
      return updatedInvestment;
    });
  }

  async remove(id: string, actor: MutationActor) {
    // Allocation.investmentId é Cascade, e Return.allocationId também — tudo é removido.
    return this.prisma.$transaction(async (tx) => {
      const [investment] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Investment"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!investment) throw new NotFoundException('Aporte não encontrado');

      // O lock das alocações impede retornos novos entre a coleta e o cascade.
      const cascadedAllocations = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Allocation"
        WHERE "investmentId" = ${id}
          AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      const cascadedReturns = await tx.return.findMany({
        where: {
          allocationId: { in: cascadedAllocations.map(({ id }) => id) },
          organizationId: actor.organizationId,
        },
        select: { id: true },
      });
      const deletedInvestment = await tx.investment.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.INVESTMENT,
          entityId: deletedInvestment.id,
        },
        tx,
      );
      const cascadeSource = {
        entityType: AUDIT_ENTITY_TYPES.INVESTMENT,
        entityId: deletedInvestment.id,
      };
      await this.audit.recordMany(
        [
          ...cascadedAllocations.map((allocation) => ({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.DELETE,
            entityType: AUDIT_ENTITY_TYPES.ALLOCATION,
            entityId: allocation.id,
            metadata: { cascadeSource },
          })),
          ...cascadedReturns.map((investmentReturn) => ({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.DELETE,
            entityType: AUDIT_ENTITY_TYPES.RETURN,
            entityId: investmentReturn.id,
            metadata: { cascadeSource },
          })),
        ],
        tx,
      );
      return deletedInvestment;
    });
  }

  private withComputedAmounts(investment: InvestmentWithAllocations) {
    const allocatedAmount = this.sumAllocatedToDevelopment(
      investment.allocations,
    );
    return {
      ...investment,
      allocatedAmount,
      unallocatedAmount: investment.amount - allocatedAmount,
    };
  }

  // "Alocado" = destinado a um empreendimento. Alocações em caixa geral
  // (developmentId null) contam como não-alocado (unallocatedAmount).
  private sumAllocatedToDevelopment(
    allocations: { amount: number; developmentId: string | null }[],
  ) {
    return allocations
      .filter((a) => a.developmentId != null)
      .reduce((sum, a) => sum + a.amount, 0);
  }

  private async assertInvestor(personId: string, organizationId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, organizationId },
      select: { id: true },
    });
    if (!person) {
      throw new BadRequestException(
        'Investidor inválido para esta organização',
      );
    }

    const investorRole = await this.prisma.personRole.findUnique({
      where: {
        personId_role: { personId, role: PersonRoleType.INVESTIDOR },
      },
      select: { id: true },
    });
    if (!investorRole) {
      throw new BadRequestException(
        'A pessoa não possui o papel INVESTIDOR e não pode receber aportes',
      );
    }
  }
}
