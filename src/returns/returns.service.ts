import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReturnStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getComputedReturnStatus } from './return-status';
import { CreateReturnDto } from './dto/create-return.dto';
import { UpdateReturnDto } from './dto/update-return.dto';

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

@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(organizationId: string, dto: CreateReturnDto) {
    await this.assertAllocationInOrg(dto.allocationId, organizationId);

    return this.prisma.return.create({
      data: {
        organizationId,
        allocationId: dto.allocationId,
        expectedAmount: dto.expectedAmount,
        expectedDate: new Date(dto.expectedDate),
        realizedDate: dto.realizedDate ? new Date(dto.realizedDate) : undefined,
        realizedAmount: dto.realizedAmount,
        status: dto.status,
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateReturnDto) {
    const existing = await this.prisma.return.findFirst({
      where: { id, organizationId },
    });
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

    return this.prisma.return.update({
      where: { id },
      data: {
        expectedAmount: dto.expectedAmount,
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        realizedDate: dto.realizedDate ? new Date(dto.realizedDate) : undefined,
        realizedAmount: dto.realizedAmount,
        status: dto.status,
      },
    });
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.return.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Retorno não encontrado');
    return this.prisma.return.delete({ where: { id } });
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
}
