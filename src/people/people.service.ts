import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PersonRoleType } from '@prisma/client';
import { documentPublicSelect } from '../documents/document-response';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';

@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    role?: PersonRoleType,
    search?: string,
  ) {
    const where: Prisma.PersonWhereInput = { organizationId };
    if (role) where.roles = { some: { role } };
    if (search) where.name = { contains: search, mode: 'insensitive' };

    return this.prisma.person.findMany({
      where,
      include: { roles: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    includeFinancialData = false,
  ) {
    const person = await this.prisma.person.findFirst({
      where: { id, organizationId },
      include: {
        roles: true,
        investments: includeFinancialData,
        interactions: true,
        documents: {
          where: includeFinancialData ? undefined : { investmentId: null },
          select: documentPublicSelect,
        },
      },
    });
    if (!person) throw new NotFoundException('Pessoa não encontrada');
    return person;
  }

  async create(organizationId: string, dto: CreatePersonDto) {
    await this.assertDocumentUnique(organizationId, dto.document);

    return this.prisma.person.create({
      data: {
        organizationId,
        name: dto.name,
        documentType: dto.documentType,
        document: dto.document,
        personType: dto.personType,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        notes: dto.notes,
        roles: dto.roles?.length
          ? { create: dto.roles.map((role) => ({ organizationId, role })) }
          : undefined,
      },
      include: { roles: true },
    });
  }

  async update(id: string, organizationId: string, dto: UpdatePersonDto) {
    await this.ensureExists(id, organizationId);

    if (dto.document) {
      await this.assertDocumentUnique(organizationId, dto.document, id);
    }

    return this.prisma.person.update({
      where: { id },
      data: {
        name: dto.name,
        documentType: dto.documentType,
        document: dto.document,
        personType: dto.personType,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        notes: dto.notes,
      },
      include: { roles: true },
    });
  }

  async remove(id: string, organizationId: string) {
    await this.ensureExists(id, organizationId);

    // Investment é a única relação com onDelete Restrict apontando para Person;
    // pré-checa para dar um erro claro em vez de estourar violação de FK (500).
    const investments = await this.prisma.investment.count({
      where: { investorId: id },
    });
    if (investments > 0) {
      throw new ConflictException(
        'Pessoa possui vínculos existentes e não pode ser removida',
      );
    }

    return this.prisma.person.delete({ where: { id } });
  }

  async addRole(
    id: string,
    organizationId: string,
    role: PersonRoleType,
    includeFinancialData = false,
  ) {
    await this.ensureExists(id, organizationId);
    try {
      await this.prisma.personRole.create({
        data: { personId: id, organizationId, role },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Pessoa já possui este papel');
      }
      throw e;
    }
    return this.findOne(id, organizationId, includeFinancialData);
  }

  async removeRole(
    id: string,
    organizationId: string,
    role: PersonRoleType,
    includeFinancialData = false,
  ) {
    await this.ensureExists(id, organizationId);
    const existing = await this.prisma.personRole.findUnique({
      where: { personId_role: { personId: id, role } },
    });
    if (!existing)
      throw new NotFoundException('Papel não encontrado nesta pessoa');

    await this.prisma.personRole.delete({
      where: { personId_role: { personId: id, role } },
    });
    return this.findOne(id, organizationId, includeFinancialData);
  }

  private async ensureExists(id: string, organizationId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!person) throw new NotFoundException('Pessoa não encontrada');
  }

  private async assertDocumentUnique(
    organizationId: string,
    document: string,
    ignoreId?: string,
  ) {
    const existing = await this.prisma.person.findFirst({
      where: {
        organizationId,
        document,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Já existe uma pessoa com este documento nesta organização',
      );
    }
  }
}
