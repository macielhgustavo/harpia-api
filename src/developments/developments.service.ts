import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DevelopmentStatus, DevelopmentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDevelopmentDto } from './dto/create-development.dto';
import { UpdateDevelopmentDto } from './dto/update-development.dto';

@Injectable()
export class DevelopmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    status?: DevelopmentStatus,
    type?: DevelopmentType,
    companyId?: string,
  ) {
    const where: Prisma.DevelopmentWhereInput = { organizationId };
    if (status) where.status = status;
    if (type) where.type = type;
    if (companyId) where.companyId = companyId;

    return this.prisma.development.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, type: true } },
        _count: { select: { units: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    includeFinancialData = false,
  ) {
    const development = await this.prisma.development.findFirst({
      where: { id, organizationId },
      include: {
        company: { select: { id: true, name: true, type: true } },
        unitTypes: true,
        units: { include: { unitType: { select: { id: true, name: true } } } },
        priceTables: true,
        _count: {
          select: {
            allocations: includeFinancialData,
            units: true,
          },
        },
      },
    });
    if (!development)
      throw new NotFoundException('Empreendimento não encontrado');
    return development;
  }

  async create(organizationId: string, dto: CreateDevelopmentDto) {
    if (dto.companyId) {
      await this.assertCompanyInOrg(dto.companyId, organizationId);
    }

    return this.prisma.development.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        companyId: dto.companyId,
        address: dto.address,
        city: dto.city,
        status: dto.status,
        expectedLaunchDate: dto.expectedLaunchDate
          ? new Date(dto.expectedLaunchDate)
          : undefined,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : undefined,
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateDevelopmentDto) {
    await this.ensureExists(id, organizationId);
    if (dto.companyId) {
      await this.assertCompanyInOrg(dto.companyId, organizationId);
    }

    return this.prisma.development.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        companyId: dto.companyId,
        address: dto.address,
        city: dto.city,
        status: dto.status,
        expectedLaunchDate: dto.expectedLaunchDate
          ? new Date(dto.expectedLaunchDate)
          : undefined,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : undefined,
      },
    });
  }

  async remove(id: string, organizationId: string) {
    await this.ensureExists(id, organizationId);

    const allocations = await this.prisma.allocation.count({
      where: { developmentId: id },
    });
    if (allocations > 0) {
      throw new ConflictException(
        'Empreendimento possui vínculos existentes e não pode ser removido',
      );
    }

    return this.prisma.development.delete({ where: { id } });
  }

  private async ensureExists(id: string, organizationId: string) {
    const development = await this.prisma.development.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!development) {
      throw new NotFoundException('Empreendimento não encontrado');
    }
  }

  private async assertCompanyInOrg(companyId: string, organizationId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, organizationId },
      select: { id: true },
    });
    if (!company) {
      throw new BadRequestException('Empresa inválida para esta organização');
    }
  }
}
