import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Limpa em ordem segura de FK (dependentes primeiro) para permitir re-execução.
  await prisma.return.deleteMany();
  await prisma.allocation.deleteMany();
  await prisma.investment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.unitPrice.deleteMany();
  await prisma.priceTable.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.unitType.deleteMany();
  await prisma.development.deleteMany();
  await prisma.bankAccount.deleteMany();
  await prisma.company.deleteMany();
  await prisma.personRole.deleteMany();
  await prisma.person.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // -------------------------------------------------------------------------
  // Organization
  // -------------------------------------------------------------------------
  const org = await prisma.organization.create({
    data: { name: 'Harpia Incorporadora' },
  });
  const organizationId = org.id;

  // -------------------------------------------------------------------------
  // User admin
  // -------------------------------------------------------------------------
  await prisma.user.create({
    data: {
      email: 'admin@harpia.com',
      password: await bcrypt.hash('harpia123', 10),
      name: 'Admin Harpia',
      organizationId,
      role: 'OWNER',
      acceptedAt: new Date(),
    },
  });

  // -------------------------------------------------------------------------
  // Companies (Incorporadora + SPEs)
  // -------------------------------------------------------------------------
  const incorporadora = await prisma.company.create({
    data: {
      organizationId,
      name: 'Harpia Incorporadora Ltda',
      cnpj: '12.345.678/0001-90',
      type: 'INCORPORADORA',
    },
  });
  const speAurora = await prisma.company.create({
    data: {
      organizationId,
      name: 'SPE Residencial Aurora',
      cnpj: '23.456.789/0001-01',
      type: 'SPE',
    },
  });
  const speHorizonte = await prisma.company.create({
    data: {
      organizationId,
      name: 'SPE Torre Horizonte',
      cnpj: '34.567.890/0001-12',
      type: 'SPE',
    },
  });

  // -------------------------------------------------------------------------
  // BankAccounts (uma para a incorporadora, uma por SPE)
  // -------------------------------------------------------------------------
  await prisma.bankAccount.createMany({
    data: [
      {
        organizationId,
        bank: 'Banco do Brasil',
        agency: '1234-5',
        account: '10001-0',
        companyId: incorporadora.id,
      },
      {
        organizationId,
        bank: 'Itaú',
        agency: '2345-6',
        account: '20002-1',
        companyId: speAurora.id,
      },
      {
        organizationId,
        bank: 'Bradesco',
        agency: '3456-7',
        account: '30003-2',
        companyId: speHorizonte.id,
      },
    ],
  });

  // -------------------------------------------------------------------------
  // People + PersonRole
  // -------------------------------------------------------------------------
  const joao = await prisma.person.create({
    data: {
      organizationId,
      name: 'João Mendes',
      documentType: 'CPF',
      document: '111.222.333-44',
      personType: 'FISICA',
      email: 'joao@email.com',
      phone: '(41) 99999-0001',
      roles: {
        create: [
          { organizationId, role: 'INVESTIDOR' },
          { organizationId, role: 'CLIENTE' },
        ],
      },
    },
  });
  const maria = await prisma.person.create({
    data: {
      organizationId,
      name: 'Maria Santos',
      documentType: 'CPF',
      document: '222.333.444-55',
      personType: 'FISICA',
      email: 'maria@email.com',
      phone: '(11) 99999-0002',
      roles: { create: [{ organizationId, role: 'INVESTIDOR' }] },
    },
  });
  const carlos = await prisma.person.create({
    data: {
      organizationId,
      name: 'Carlos Braga',
      documentType: 'CPF',
      document: '333.444.555-66',
      personType: 'FISICA',
      email: 'carlos@email.com',
      roles: { create: [{ organizationId, role: 'LEAD' }] },
    },
  });
  await prisma.person.create({
    data: {
      organizationId,
      name: 'Ana Corretora',
      documentType: 'CPF',
      document: '444.555.666-77',
      personType: 'FISICA',
      email: 'ana@email.com',
      roles: { create: [{ organizationId, role: 'CORRETOR' }] },
    },
  });
  await prisma.person.create({
    data: {
      organizationId,
      name: 'Construtora Alfa Ltda',
      documentType: 'CNPJ',
      document: '45.678.901/0001-23',
      personType: 'JURIDICA',
      email: 'contato@construtoraalfa.com',
      roles: { create: [{ organizationId, role: 'FORNECEDOR' }] },
    },
  });
  await prisma.person.create({
    data: {
      organizationId,
      name: 'Pedro Cliente',
      documentType: 'CPF',
      document: '555.666.777-88',
      personType: 'FISICA',
      email: 'pedro@email.com',
      roles: { create: [{ organizationId, role: 'CLIENTE' }] },
    },
  });

  // -------------------------------------------------------------------------
  // Developments
  // -------------------------------------------------------------------------
  const aurora = await prisma.development.create({
    data: {
      organizationId,
      name: 'Residencial Aurora',
      description: 'Edifício residencial em captação',
      type: 'PREDIO',
      companyId: speAurora.id,
      address: 'Rua das Araucárias, 100',
      city: 'Curitiba',
      status: 'EM_CAPTACAO',
      expectedLaunchDate: new Date('2026-09-01'),
      expectedDeliveryDate: new Date('2028-12-01'),
    },
  });
  const horizonte = await prisma.development.create({
    data: {
      organizationId,
      name: 'Torre Horizonte',
      description: 'Torre residencial em obra',
      type: 'PREDIO',
      companyId: speHorizonte.id,
      address: 'Av. Paulista, 2000',
      city: 'São Paulo',
      status: 'EM_OBRA',
      expectedDeliveryDate: new Date('2027-06-01'),
    },
  });

  // -------------------------------------------------------------------------
  // UnitTypes (Residencial Aurora)
  // -------------------------------------------------------------------------
  const t2q = await prisma.unitType.create({
    data: {
      organizationId,
      developmentId: aurora.id,
      name: '2Q Standard',
      bedrooms: 2,
      suites: 1,
      standardArea: 55,
    },
  });
  const t3q = await prisma.unitType.create({
    data: {
      organizationId,
      developmentId: aurora.id,
      name: '3Q Suíte',
      bedrooms: 3,
      suites: 1,
      standardArea: 75,
    },
  });
  const tCobertura = await prisma.unitType.create({
    data: {
      organizationId,
      developmentId: aurora.id,
      name: 'Cobertura',
      bedrooms: 3,
      suites: 2,
      standardArea: 120,
    },
  });

  // -------------------------------------------------------------------------
  // Units (Residencial Aurora) + preço na Tabela Captação
  // -------------------------------------------------------------------------
  const priceTable = await prisma.priceTable.create({
    data: {
      organizationId,
      developmentId: aurora.id,
      name: 'Tabela Captação',
      phase: 'CAPTACAO',
      active: true,
    },
  });

  const unitsSeed = [
    { identifier: 'Apto 101', unitTypeId: t2q.id, builtArea: 55, parkingSpots: 1, status: 'DISPONIVEL' as const, price: 300000 },
    { identifier: 'Apto 102', unitTypeId: t2q.id, builtArea: 55, parkingSpots: 1, status: 'DISPONIVEL' as const, price: 310000 },
    { identifier: 'Apto 201', unitTypeId: t3q.id, builtArea: 75, parkingSpots: 2, status: 'RESERVADA' as const, price: 450000 },
    { identifier: 'Apto 202', unitTypeId: t3q.id, builtArea: 75, parkingSpots: 2, status: 'DISPONIVEL' as const, price: 470000 },
    { identifier: 'Apto 301', unitTypeId: tCobertura.id, builtArea: 120, parkingSpots: 3, status: 'DISPONIVEL' as const, price: 700000 },
    { identifier: 'Apto 302', unitTypeId: tCobertura.id, builtArea: 120, parkingSpots: 3, status: 'VENDIDA' as const, price: 720000 },
  ];

  for (const u of unitsSeed) {
    const unit = await prisma.unit.create({
      data: {
        organizationId,
        developmentId: aurora.id,
        identifier: u.identifier,
        unitTypeId: u.unitTypeId,
        category: 'APARTAMENTO',
        grouping: 'Torre A',
        builtArea: u.builtArea,
        parkingSpots: u.parkingSpots,
        status: u.status,
      },
    });
    await prisma.unitPrice.create({
      data: {
        organizationId,
        unitId: unit.id,
        priceTableId: priceTable.id,
        value: u.price,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Investments + Allocations + Returns
  // -------------------------------------------------------------------------
  // João Mendes: R$ 500.000 totalmente alocado (Aurora 300k + Horizonte 200k)
  const investJoao = await prisma.investment.create({
    data: {
      organizationId,
      investorId: joao.id,
      amount: 500000,
      date: new Date('2026-01-15'),
      type: 'FINANCEIRO',
      notes: 'Aporte dividido entre Aurora e Horizonte',
    },
  });
  const allocJoaoAurora = await prisma.allocation.create({
    data: {
      organizationId,
      investmentId: investJoao.id,
      developmentId: aurora.id,
      amount: 300000,
      date: new Date('2026-01-15'),
    },
  });
  await prisma.allocation.create({
    data: {
      organizationId,
      investmentId: investJoao.id,
      developmentId: horizonte.id,
      amount: 200000,
      date: new Date('2026-01-15'),
    },
  });

  // Maria Santos: R$ 180.000 — 100k para Horizonte, 80k em caixa geral (developmentId null)
  const investMaria = await prisma.investment.create({
    data: {
      organizationId,
      investorId: maria.id,
      amount: 180000,
      date: new Date('2026-02-10'),
      type: 'FINANCEIRO',
    },
  });
  const allocMariaHorizonte = await prisma.allocation.create({
    data: {
      organizationId,
      investmentId: investMaria.id,
      developmentId: horizonte.id,
      amount: 100000,
      date: new Date('2026-02-10'),
    },
  });
  await prisma.allocation.create({
    data: {
      organizationId,
      investmentId: investMaria.id,
      developmentId: null,
      amount: 80000,
      date: new Date('2026-02-10'),
      notes: 'Em caixa geral, ainda não alocado a empreendimento',
    },
  });

  // Returns pendurados nas alocações
  await prisma.return.createMany({
    data: [
      {
        organizationId,
        allocationId: allocJoaoAurora.id,
        expectedAmount: 30000,
        expectedDate: new Date('2026-08-15'),
        status: 'PENDENTE',
      },
      {
        organizationId,
        allocationId: allocJoaoAurora.id,
        expectedAmount: 30000,
        expectedDate: new Date('2025-12-01'),
        status: 'PENDENTE',
      },
      {
        organizationId,
        allocationId: allocMariaHorizonte.id,
        expectedAmount: 25000,
        expectedDate: new Date('2026-09-20'),
        status: 'PENDENTE',
      },
    ],
  });

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------
  await prisma.interaction.createMany({
    data: [
      {
        organizationId,
        personId: joao.id,
        type: 'REUNIAO',
        date: new Date('2026-06-15'),
        summary: 'Apresentação do Residencial Aurora',
      },
      {
        organizationId,
        personId: carlos.id,
        type: 'LIGACAO',
        date: new Date('2026-06-25'),
        summary: 'Primeiro contato - interesse em 2 quartos',
      },
    ],
  });

  console.log('Seed concluído: organização "Harpia Incorporadora" populada com dados de exemplo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
