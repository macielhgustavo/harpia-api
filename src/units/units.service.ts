import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UnitStatus } from '@prisma/client';
import { documentPublicSelect } from '../documents/document-response';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    developmentId: string,
    status?: UnitStatus,
    grouping?: string,
  ) {
    if (!developmentId) {
      throw new BadRequestException('developmentId é obrigatório');
    }
    await this.assertDevelopmentInOrg(developmentId, organizationId);

    const where: Prisma.UnitWhereInput = { organizationId, developmentId };
    if (status) where.status = status;
    if (grouping) where.grouping = grouping;

    return this.prisma.unit.findMany({
      where,
      include: {
        unitType: { select: { id: true, name: true } },
        prices: {
          include: { priceTable: { select: { id: true, name: true } } },
        },
      },
      orderBy: { identifier: 'asc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    includeFinancialData = false,
  ) {
    const unit = await this.prisma.unit.findFirst({
      where: { id, organizationId },
      include: {
        unitType: { select: { id: true, name: true } },
        prices: {
          include: {
            priceTable: { select: { id: true, name: true, phase: true } },
          },
        },
        documents: {
          where: includeFinancialData ? undefined : { investmentId: null },
          select: documentPublicSelect,
        },
      },
    });
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    return unit;
  }

  async create(organizationId: string, dto: CreateUnitDto) {
    await this.assertDevelopmentInOrg(dto.developmentId, organizationId);
    if (dto.unitTypeId) {
      await this.assertUnitTypeInDevelopment(
        dto.unitTypeId,
        dto.developmentId,
        organizationId,
      );
    }

    return this.prisma.unit.create({
      data: {
        organizationId,
        developmentId: dto.developmentId,
        identifier: dto.identifier,
        unitTypeId: dto.unitTypeId,
        category: dto.category,
        grouping: dto.grouping,
        landArea: dto.landArea,
        builtArea: dto.builtArea,
        parkingSpots: dto.parkingSpots,
        status: dto.status,
        notes: dto.notes,
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateUnitDto) {
    const unit = await this.prisma.unit.findFirst({
      where: { id, organizationId },
      select: { id: true, developmentId: true },
    });
    if (!unit) throw new NotFoundException('Unidade não encontrada');

    if (dto.unitTypeId) {
      await this.assertUnitTypeInDevelopment(
        dto.unitTypeId,
        unit.developmentId,
        organizationId,
      );
    }

    return this.prisma.unit.update({
      where: { id },
      data: {
        identifier: dto.identifier,
        unitTypeId: dto.unitTypeId,
        category: dto.category,
        grouping: dto.grouping,
        landArea: dto.landArea,
        builtArea: dto.builtArea,
        parkingSpots: dto.parkingSpots,
        status: dto.status,
        notes: dto.notes,
      },
    });
  }

  async remove(id: string, organizationId: string) {
    const unit = await this.prisma.unit.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    // UnitPrice.unitId é onDelete Cascade — os preços da unidade são removidos.
    return this.prisma.unit.delete({ where: { id } });
  }

  private async assertDevelopmentInOrg(
    developmentId: string,
    organizationId: string,
  ) {
    const development = await this.prisma.development.findFirst({
      where: { id: developmentId, organizationId },
      select: { id: true },
    });
    if (!development) {
      throw new BadRequestException(
        'Empreendimento inválido para esta organização',
      );
    }
  }

  private async assertUnitTypeInDevelopment(
    unitTypeId: string,
    developmentId: string,
    organizationId: string,
  ) {
    const unitType = await this.prisma.unitType.findFirst({
      where: { id: unitTypeId, organizationId, developmentId },
      select: { id: true },
    });
    if (!unitType) {
      throw new BadRequestException(
        'Tipologia inválida para este empreendimento',
      );
    }
  }
}
