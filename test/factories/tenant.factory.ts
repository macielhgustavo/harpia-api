import { PrismaService } from '../../src/prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  CompanyType,
  DevelopmentStatus,
  DevelopmentType,
  Unit,
  UnitCategory,
  UserRole,
} from '@prisma/client';

export const E2E_PASSWORD = 'Harpia-E2E-Password-2026!';

export async function createTenantFixture(
  prisma: PrismaService,
  options: { unitCount?: number; label?: string } = {},
) {
  const suffix = `${options.label ?? 'tenant'}-${randomUUID().slice(0, 8)}`;
  const password = await bcrypt.hash(E2E_PASSWORD, 4);
  const organization = await prisma.organization.create({
    data: { name: `Organização ${suffix}` },
  });
  const commercial = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: `Comercial ${suffix}`,
      email: `commercial-${suffix}@e2e.harpia.local`,
      password,
      role: UserRole.COMERCIAL,
    },
  });
  const reader = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: `Leitura ${suffix}`,
      email: `reader-${suffix}@e2e.harpia.local`,
      password,
      role: UserRole.LEITURA,
    },
  });
  const company = await prisma.company.create({
    data: {
      organizationId: organization.id,
      name: `SPE Aurora ${suffix}`,
      cnpj: randomUUID().replace(/\D/g, '').padEnd(14, '0').slice(0, 14),
      type: CompanyType.SPE,
    },
  });
  const development = await prisma.development.create({
    data: {
      organizationId: organization.id,
      companyId: company.id,
      name: `Residencial Aurora ${suffix}`,
      type: DevelopmentType.PREDIO,
      status: DevelopmentStatus.EM_OBRA,
      city: 'São Paulo',
      expectedDeliveryDate: new Date('2028-12-15T12:00:00.000Z'),
    },
  });
  const unitType = await prisma.unitType.create({
    data: {
      organizationId: organization.id,
      developmentId: development.id,
      name: 'Apartamento 2 dormitórios',
      bedrooms: 2,
      standardArea: 64.5,
    },
  });
  const priceTable = await prisma.priceTable.create({
    data: {
      organizationId: organization.id,
      developmentId: development.id,
      name: 'Tabela E2E vigente',
      phase: 'Lançamento',
      active: true,
    },
  });
  const units: Unit[] = [];
  for (let index = 0; index < (options.unitCount ?? 1); index += 1) {
    const unit = await prisma.unit.create({
      data: {
        organizationId: organization.id,
        developmentId: development.id,
        unitTypeId: unitType.id,
        identifier: `A-${String(index + 101).padStart(3, '0')}-${suffix}`,
        category: UnitCategory.APARTAMENTO,
        builtArea: 64.5,
        parkingSpots: 1,
      },
    });
    await prisma.unitPrice.create({
      data: {
        organizationId: organization.id,
        unitId: unit.id,
        priceTableId: priceTable.id,
        value: 250000,
      },
    });
    units.push(unit);
  }
  return {
    organization,
    commercial,
    reader,
    company,
    development,
    unitType,
    priceTable,
    units,
  };
}
