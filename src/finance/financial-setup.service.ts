import { Injectable, NotFoundException } from '@nestjs/common';
import { CompanyType, FinancialCategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CATEGORIES = [
  [FinancialCategoryType.RECEITA, 'Venda de unidade'],
  [FinancialCategoryType.RECEITA, 'Investimento'],
  [FinancialCategoryType.RECEITA, 'Outras receitas'],
  [FinancialCategoryType.DESPESA, 'Obra'],
  [FinancialCategoryType.DESPESA, 'Marketing'],
  [FinancialCategoryType.DESPESA, 'Comissão'],
  [FinancialCategoryType.DESPESA, 'Retorno de investidor'],
  [FinancialCategoryType.DESPESA, 'Administrativo'],
  [FinancialCategoryType.DESPESA, 'Tributos'],
  [FinancialCategoryType.DESPESA, 'Distrato'],
  [FinancialCategoryType.DESPESA, 'Outras despesas'],
] as const;

type SetupDb = Pick<
  Prisma.TransactionClient,
  'financialCategory' | 'costCenter' | 'company'
>;

@Injectable()
export class FinancialSetupService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureOrganization(
    organizationId: string,
    database: SetupDb = this.prisma,
  ) {
    await Promise.all(
      DEFAULT_CATEGORIES.map(([type, name]) =>
        database.financialCategory.upsert({
          where: { organizationId_name_type: { organizationId, name, type } },
          update: {},
          create: { organizationId, name, type, isDefault: true },
        }),
      ),
    );

    const companies = await database.company.findMany({
      where: { organizationId },
      select: { id: true, name: true, type: true },
      orderBy: { createdAt: 'asc' },
    });
    const incorporator = companies.find(
      ({ type }) => type === CompanyType.INCORPORADORA,
    );
    await database.costCenter.upsert({
      where: {
        organizationId_name: {
          organizationId,
          name: 'Incorporadora geral',
        },
      },
      update: incorporator ? { companyId: incorporator.id } : {},
      create: {
        organizationId,
        name: 'Incorporadora geral',
        companyId: incorporator?.id,
      },
    });
    await Promise.all(
      companies
        .filter(({ type }) => type === CompanyType.SPE)
        .map((company) =>
          database.costCenter.upsert({
            where: {
              organizationId_name: {
                organizationId,
                name: company.name,
              },
            },
            update: { companyId: company.id },
            create: {
              organizationId,
              name: company.name,
              companyId: company.id,
            },
          }),
        ),
    );
  }

  async expenseCategory(
    organizationId: string,
    name: string,
    database: SetupDb = this.prisma,
  ) {
    await this.ensureOrganization(organizationId, database);
    const category = await database.financialCategory.findUnique({
      where: {
        organizationId_name_type: {
          organizationId,
          name,
          type: FinancialCategoryType.DESPESA,
        },
      },
    });
    if (!category) throw new NotFoundException('Categoria financeira ausente');
    return category;
  }

  async generalCostCenter(
    organizationId: string,
    database: SetupDb = this.prisma,
  ) {
    await this.ensureOrganization(organizationId, database);
    const costCenter = await database.costCenter.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: 'Incorporadora geral',
        },
      },
    });
    if (!costCenter) throw new NotFoundException('Centro de custo ausente');
    return costCenter;
  }
}
