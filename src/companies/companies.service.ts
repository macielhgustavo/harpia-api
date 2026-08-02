import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    type?: CompanyType,
    includeFinancialData = false,
  ) {
    const where: Prisma.CompanyWhereInput = { organizationId };
    if (type) where.type = type;

    return this.prisma.company.findMany({
      where,
      include: {
        developments: { select: { id: true, name: true, status: true } },
        _count: {
          select: {
            developments: true,
            bankAccounts: includeFinancialData,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    includeFinancialData = false,
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId },
      include: {
        developments: true,
        bankAccounts: includeFinancialData,
      },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');
    return company;
  }

  async create(organizationId: string, dto: CreateCompanyDto) {
    return this.prisma.company.create({
      data: {
        organizationId,
        name: dto.name,
        cnpj: dto.cnpj,
        type: dto.type,
        notes: dto.notes,
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateCompanyDto) {
    await this.ensureExists(id, organizationId);
    return this.prisma.company.update({
      where: { id },
      data: {
        name: dto.name,
        cnpj: dto.cnpj,
        type: dto.type,
        notes: dto.notes,
      },
    });
  }

  async remove(id: string, organizationId: string) {
    await this.ensureExists(id, organizationId);

    const developments = await this.prisma.development.count({
      where: { companyId: id },
    });
    if (developments > 0) {
      throw new ConflictException(
        'Empresa possui empreendimentos vinculados e não pode ser removida',
      );
    }

    return this.prisma.company.delete({ where: { id } });
  }

  private async ensureExists(id: string, organizationId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');
  }
}
