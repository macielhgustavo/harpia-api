import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReturnStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { getComputedReturnStatus } from './return-status';
import { CreateReturnDto } from './dto/create-return.dto';
import { UpdateReturnDto } from './dto/update-return.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

const RETURN_UPDATE_FIELDS: (keyof UpdateReturnDto)[] = [
  'expectedAmount',
  'expectedDate',
  'realizedDate',
  'realizedAmount',
  'status',
];

// Return + contexto da alocação (development + investment/investidor).
const returnInclude = {
  allocation: {
    include: {
      development: { select: { id: true, name: true } },
      investment: {
        select: {
          id: true,
          investor: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.ReturnInclude;

type ReturnWithContext = Prisma.ReturnGetPayload<{
  include: typeof returnInclude;
}>;

interface LockedReturnState {
  id: string;
  status: ReturnStatus;
  realizedDate: Date | null;
  realizedAmount: number | null;
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    organizationId: string,
    filters: {
      allocationId?: string;
      investmentId?: string;
      developmentId?: string;
      status?: ReturnStatus;
    },
  ) {
    const where: Prisma.ReturnWhereInput = { organizationId };
    if (filters.allocationId) where.allocationId = filters.allocationId;
    if (filters.investmentId || filters.developmentId) {
      where.allocation = {
        ...(filters.investmentId ? { investmentId: filters.investmentId } : {}),
        ...(filters.developmentId
          ? { developmentId: filters.developmentId }
          : {}),
      };
    }

    const returns = await this.prisma.return.findMany({
      where,
      include: returnInclude,
      orderBy: { expectedDate: 'asc' },
    });

    const withStatus = returns.map((r) => this.withComputedStatus(r));

    // O filtro de status considera o status COMPUTADO (ATRASADO automático).
    if (filters.status) {
      return withStatus.filter((r) => r.status === filters.status);
    }
    return withStatus;
  }

  async findOne(id: string, organizationId: string) {
    const found = await this.prisma.return.findFirst({
      where: { id, organizationId },
      include: returnInclude,
    });
    if (!found) throw new NotFoundException('Retorno não encontrado');
    return this.withComputedStatus(found);
  }

  async create(actor: MutationActor, dto: CreateReturnDto) {
    this.assertPersistableStatus(dto.status);
    if (
      dto.status === ReturnStatus.PAGO &&
      (!dto.realizedDate || dto.realizedAmount == null)
    ) {
      throw new BadRequestException(
        'realizedDate e realizedAmount são obrigatórios quando status é PAGO',
      );
    }
    await this.assertAllocationInOrg(dto.allocationId, actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const createdReturn = await tx.return.create({
        data: {
          organizationId: actor.organizationId,
          allocationId: dto.allocationId,
          expectedAmount: dto.expectedAmount,
          expectedDate: new Date(dto.expectedDate),
          realizedDate: dto.realizedDate
            ? new Date(dto.realizedDate)
            : undefined,
          realizedAmount: dto.realizedAmount,
          status: dto.status,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.RETURN,
          entityId: createdReturn.id,
        },
        tx,
      );
      if (createdReturn.status === ReturnStatus.PAGO) {
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.RETURN_PAID,
            entityType: AUDIT_ENTITY_TYPES.RETURN,
            entityId: createdReturn.id,
            metadata: { newStatus: createdReturn.status },
          },
          tx,
        );
      }
      return createdReturn;
    });
  }

  async update(id: string, actor: MutationActor, dto: UpdateReturnDto) {
    this.assertPersistableStatus(dto.status);
    const changedFields = RETURN_UPDATE_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    return this.prisma.$transaction(async (tx) => {
      // Serializing by row makes validation and audit classification observe
      // the latest committed status under concurrent updates.
      const [existing] = await tx.$queryRaw<LockedReturnState[]>`
        SELECT "id", "status", "realizedDate", "realizedAmount"
        FROM "Return"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!existing) throw new NotFoundException('Retorno não encontrado');

      // Marcar como PAGO exige realizedDate e realizedAmount (no payload ou já existentes).
      if (dto.status === ReturnStatus.PAGO) {
        const realizedDate = dto.realizedDate ?? existing.realizedDate;
        const realizedAmount = dto.realizedAmount ?? existing.realizedAmount;
        if (!realizedDate || realizedAmount == null) {
          throw new BadRequestException(
            'realizedDate e realizedAmount são obrigatórios quando status é PAGO',
          );
        }
      }

      const statusChange =
        dto.status !== undefined && dto.status !== existing.status
          ? { oldStatus: existing.status, newStatus: dto.status }
          : {};
      const auditAction =
        dto.status === ReturnStatus.PAGO &&
        existing.status !== ReturnStatus.PAGO
          ? AUDIT_ACTIONS.RETURN_PAID
          : AUDIT_ACTIONS.UPDATE;
      const updatedReturn = await tx.return.update({
        where: { id },
        data: {
          expectedAmount: dto.expectedAmount,
          expectedDate: dto.expectedDate
            ? new Date(dto.expectedDate)
            : undefined,
          realizedDate: dto.realizedDate
            ? new Date(dto.realizedDate)
            : undefined,
          realizedAmount: dto.realizedAmount,
          status: dto.status,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: auditAction,
          entityType: AUDIT_ENTITY_TYPES.RETURN,
          entityId: updatedReturn.id,
          metadata: { changedFields, ...statusChange },
        },
        tx,
      );
      return updatedReturn;
    });
  }

  async remove(id: string, actor: MutationActor) {
    const existing = await this.prisma.return.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Retorno não encontrado');
    return this.prisma.$transaction(async (tx) => {
      const deletedReturn = await tx.return.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.RETURN,
          entityId: deletedReturn.id,
        },
        tx,
      );
      return deletedReturn;
    });
  }

  // Reporta ATRASADO quando o status persistido é PENDENTE e a data já venceu.
  // Não altera o banco.
  private withComputedStatus(r: ReturnWithContext) {
    return {
      ...r,
      status: getComputedReturnStatus(r.status, r.expectedDate),
    };
  }

  private async assertAllocationInOrg(
    allocationId: string,
    organizationId: string,
  ) {
    const allocation = await this.prisma.allocation.findFirst({
      where: { id: allocationId, organizationId },
      select: { id: true },
    });
    if (!allocation) {
      throw new BadRequestException('Alocação inválida para esta organização');
    }
  }

  private assertPersistableStatus(status?: ReturnStatus) {
    if (status === ReturnStatus.ATRASADO) {
      throw new BadRequestException(
        'ATRASADO é um status calculado e não pode ser persistido',
      );
    }
  }
}
