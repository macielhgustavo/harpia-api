import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyType, Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

const COMPANY_UPDATE_FIELDS: (keyof UpdateCompanyDto)[] = [
  'name',
  'cnpj',
  'type',
  'notes',
];

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async create(actor: MutationActor, dto: CreateCompanyDto) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          organizationId: actor.organizationId,
          name: dto.name,
          cnpj: dto.cnpj,
          type: dto.type,
          notes: dto.notes,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.COMPANY,
          entityId: company.id,
        },
        tx,
      );
      return company;
    });
  }

  async update(id: string, actor: MutationActor, dto: UpdateCompanyDto) {
    await this.ensureExists(id, actor.organizationId);
    const changedFields = COMPANY_UPDATE_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.update({
        where: { id },
        data: {
          name: dto.name,
          cnpj: dto.cnpj,
          type: dto.type,
          notes: dto.notes,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.COMPANY,
          entityId: company.id,
          metadata: { changedFields },
        },
        tx,
      );
      return company;
    });
  }

  async remove(id: string, actor: MutationActor) {
    return this.prisma.$transaction(async (tx) => {
      const [company] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Company"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!company) throw new NotFoundException('Empresa não encontrada');

      const developments = await tx.development.count({
        where: { companyId: id },
      });
      if (developments > 0) {
        throw new ConflictException(
          'Empresa possui empreendimentos vinculados e não pode ser removida',
        );
      }

      const deletedCompany = await tx.company.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.COMPANY,
          entityId: deletedCompany.id,
        },
        tx,
      );
      return deletedCompany;
    });
  }

  private async ensureExists(id: string, organizationId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');
  }
}
