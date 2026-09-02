import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinancialCategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { CreateFinancialCategoryDto } from './dto/create-financial-category.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';
import { UpdateFinancialCategoryDto } from './dto/update-financial-category.dto';
import { FinancialSetupService } from './financial-setup.service';

@Injectable()
export class FinancialSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinancialSetupService,
  ) {}

  async listCategories(organizationId: string, type?: FinancialCategoryType) {
    await this.setup.ensureOrganization(organizationId);
    return this.prisma.financialCategory.findMany({
      where: { organizationId, ...(type ? { type } : {}) },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(
    organizationId: string,
    dto: CreateFinancialCategoryDto,
  ) {
    try {
      return await this.prisma.financialCategory.create({
        data: { organizationId, name: dto.name, type: dto.type },
      });
    } catch (error) {
      this.rethrowDuplicate(error, 'Já existe uma categoria com esse nome');
    }
  }

  async updateCategory(
    id: string,
    organizationId: string,
    dto: UpdateFinancialCategoryDto,
  ) {
    await this.requireCategory(id, organizationId);
    try {
      return await this.prisma.financialCategory.update({
        where: { id },
        data: { name: dto.name, type: dto.type, active: dto.active },
      });
    } catch (error) {
      this.rethrowDuplicate(error, 'Já existe uma categoria com esse nome');
    }
  }

  async listCostCenters(organizationId: string) {
    await this.setup.ensureOrganization(organizationId);
    return this.prisma.costCenter.findMany({
      where: { organizationId },
      include: {
        company: { select: { id: true, name: true, type: true } },
        development: { select: { id: true, name: true } },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async createCostCenter(organizationId: string, dto: CreateCostCenterDto) {
    await this.assertContext(organizationId, dto.companyId, dto.developmentId);
    try {
      return await this.prisma.costCenter.create({
        data: { organizationId, ...dto },
      });
    } catch (error) {
      this.rethrowDuplicate(
        error,
        'Já existe um centro de custo com esse nome',
      );
    }
  }

  async updateCostCenter(
    id: string,
    organizationId: string,
    dto: UpdateCostCenterDto,
  ) {
    const current = await this.prisma.costCenter.findFirst({
      where: { id, organizationId },
    });
    if (!current) throw new NotFoundException('Centro de custo não encontrado');
    await this.assertContext(
      organizationId,
      dto.companyId ?? current.companyId ?? undefined,
      dto.developmentId ?? current.developmentId ?? undefined,
    );
    try {
      return await this.prisma.costCenter.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      this.rethrowDuplicate(
        error,
        'Já existe um centro de custo com esse nome',
      );
    }
  }

  private async requireCategory(id: string, organizationId: string) {
    const category = await this.prisma.financialCategory.findFirst({
      where: { id, organizationId },
    });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    return category;
  }

  private async assertContext(
    organizationId: string,
    companyId?: string,
    developmentId?: string,
  ) {
    const [company, development] = await Promise.all([
      companyId
        ? this.prisma.company.findFirst({
            where: { id: companyId, organizationId },
            select: { id: true },
          })
        : null,
      developmentId
        ? this.prisma.development.findFirst({
            where: { id: developmentId, organizationId },
            select: { id: true, companyId: true },
          })
        : null,
    ]);
    if (companyId && !company)
      throw new BadRequestException('Empresa inválida');
    if (developmentId && !development) {
      throw new BadRequestException('Empreendimento inválido');
    }
    if (
      companyId &&
      development?.companyId &&
      development.companyId !== companyId
    ) {
      throw new BadRequestException('Empreendimento não pertence à empresa');
    }
  }

  private rethrowDuplicate(error: unknown, message: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
    throw error;
  }
}
