/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantFixture } from './factories/tenant.factory';
import { createE2eApplication } from './setup/e2e-app';
import { bearer, login } from './setup/http';

describe('CRM unit matching (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Awaited<ReturnType<typeof createTenantFixture>>;
  let other: Awaited<ReturnType<typeof createTenantFixture>>;
  let token: string;
  let readerToken: string;
  let otherToken: string;
  let opportunityId: string;
  let personId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApplication());
    fixture = await createTenantFixture(prisma, {
      label: 'match-a',
      unitCount: 5,
    });
    other = await createTenantFixture(prisma, { label: 'match-b' });
    [token, readerToken, otherToken] = await Promise.all([
      login(app, fixture.commercial.email),
      login(app, fixture.reader.email),
      login(app, other.commercial.email),
    ]);
    const person = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(token))
      .send({
        name: 'Cliente matching',
        documentType: 'CPF',
        document: '52998224725',
        personType: 'FISICA',
      })
      .expect(201);
    personId = person.body.id;
    const opportunity = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(token))
      .send({ personId: person.body.id })
      .expect(201);
    opportunityId = opportunity.body.id;
  });

  afterAll(async () => app.close());

  it('requires a profile and does not reveal another tenant opportunity', async () => {
    const empty = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(readerToken))
      .expect(200);
    expect(empty.body).toMatchObject({
      data: [],
      reason: 'PROFILE_REQUIRED',
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(otherToken))
      .expect(404);
  });

  it('ranks explainably, pages stably, and excludes unavailable stock', async () => {
    await request(app.getHttpServer())
      .put(`/crm/opportunities/${opportunityId}/interest`)
      .set('Authorization', bearer(token))
      .send({
        developmentId: fixture.development.id,
        unitTypeId: fixture.unitType.id,
        minBedrooms: 2,
        maxBedrooms: 2,
        minArea: 60,
        maxArea: 70,
        minPrice: '200000.00',
        maxPrice: '300000.00',
        availableDownPayment: '50000.00',
        purpose: 'MORADIA',
      })
      .expect(200);
    await prisma.unit.update({
      where: { id: fixture.units[4].id },
      data: { status: 'BLOQUEADA' },
    });
    const first = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?page=1&pageSize=2`)
      .set('Authorization', bearer(readerToken))
      .expect(200);
    const second = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?page=2&pageSize=2`)
      .set('Authorization', bearer(readerToken))
      .expect(200);
    const final = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?page=3&pageSize=2`)
      .set('Authorization', bearer(readerToken))
      .expect(200);
    expect(first.body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    });
    expect(first.body.data).toHaveLength(2);
    expect(second.body.data).toHaveLength(2);
    expect(final.body.data).toEqual([]);
    const all = [...first.body.data, ...second.body.data];
    expect(new Set(all.map((item) => item.unit.id)).size).toBe(4);
    expect(all.map((item) => item.unit.identifier)).toEqual(
      [...all.map((item) => item.unit.identifier)].sort(),
    );
    expect(all[0].price.value).toBe('250000.00');
    expect(all[0].ranking).toMatchObject({
      priceWithinRange: true,
      matchedSoft: 3,
    });
    expect(all[0].criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DOWN_PAYMENT',
          status: 'NOT_EVALUATED',
        }),
        expect.objectContaining({ code: 'PURPOSE', status: 'NOT_EVALUATED' }),
      ]),
    );
  });

  it('keeps bedroom and area mismatches visible with their structured status', async () => {
    const differentType = await prisma.unitType.create({
      data: {
        organizationId: fixture.organization.id,
        developmentId: fixture.development.id,
        name: 'Quatro quartos',
        bedrooms: 4,
        standardArea: 110,
      },
    });
    await prisma.unit.update({
      where: { id: fixture.units[1].id },
      data: { builtArea: 50 },
    });
    await prisma.unit.update({
      where: { id: fixture.units[2].id },
      data: { builtArea: 100, unitTypeId: differentType.id },
    });
    const result = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(token))
      .expect(200);
    const below = result.body.data.find(
      (item) => item.unit.id === fixture.units[1].id,
    );
    expect(below.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'AREA', status: 'MISMATCH' }),
      ]),
    );
    expect(result.body.data.map((item) => item.unit.id)).not.toContain(
      fixture.units[2].id,
    );

    await prisma.opportunityPropertyInterest.update({
      where: { opportunityId },
      data: { unitTypeId: null },
    });
    const unrestrictedType = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(token))
      .expect(200);
    const above = unrestrictedType.body.data.find(
      (item) => item.unit.id === fixture.units[2].id,
    );
    expect(above.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BEDROOMS', status: 'MISMATCH' }),
        expect.objectContaining({ code: 'AREA', status: 'MISMATCH' }),
      ]),
    );
  });

  it('prioritizes prices in range and exposes exact deviation', async () => {
    await prisma.unitPrice.update({
      where: {
        unitId_priceTableId: {
          unitId: fixture.units[0].id,
          priceTableId: fixture.priceTable.id,
        },
      },
      data: { value: 330000 },
    });
    const result = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?pageSize=10`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(result.body.data.at(-1).unit.id).toBe(fixture.units[0].id);
    expect(result.body.data.at(-1).ranking.priceDeviation).toBe('30000.00');
    expect(result.body.data.at(-1).criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PRICE', status: 'MISMATCH' }),
      ]),
    );
  });

  it('does not recommend an actively reserved or sold unit even if its status is stale', async () => {
    await prisma.unitReservation.create({
      data: {
        organizationId: fixture.organization.id,
        unitId: fixture.units[1].id,
        personId,
        opportunityId,
        createdByUserId: fixture.commercial.id,
        expiresAt: new Date(Date.now() + 86400000),
        status: 'ATIVA',
      },
    });
    await prisma.sale.create({
      data: {
        organizationId: fixture.organization.id,
        developmentId: fixture.development.id,
        unitId: fixture.units[2].id,
        opportunityId,
        saleNumber: 'MATCH-SALE-1',
        status: 'ATIVA',
        saleDate: new Date(),
        grossAmount: '250000.00',
        discountAmount: '0.00',
        netAmount: '250000.00',
        createdByUserId: fixture.commercial.id,
      },
    });
    const result = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(result.body.pagination.total).toBe(2);
    expect(result.body.data.map((item) => item.unit.id)).not.toContain(
      fixture.units[1].id,
    );
    expect(result.body.data.map((item) => item.unit.id)).not.toContain(
      fixture.units[2].id,
    );
  });

  it('uses the latest active table, excludes units without price, and rejects invalid pagination', async () => {
    const nextTable = await prisma.priceTable.create({
      data: {
        organizationId: fixture.organization.id,
        developmentId: fixture.development.id,
        name: 'Tabela mais recente',
        phase: 'Nova fase',
        active: true,
      },
    });
    await prisma.unitPrice.create({
      data: {
        organizationId: fixture.organization.id,
        unitId: fixture.units[3].id,
        priceTableId: nextTable.id,
        value: 299999.99,
      },
    });
    await prisma.unit.create({
      data: {
        organizationId: fixture.organization.id,
        developmentId: fixture.development.id,
        unitTypeId: fixture.unitType.id,
        identifier: 'SEM-PRECO',
        category: 'APARTAMENTO',
        status: 'DISPONIVEL',
      },
    });
    const result = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(token))
      .expect(200);
    const latest = result.body.data.find(
      (item) => item.unit.id === fixture.units[3].id,
    );
    expect(latest.price).toMatchObject({
      value: '299999.99',
      priceTable: { id: nextTable.id },
    });
    expect(result.body.data.map((item) => item.unit.identifier)).not.toContain(
      'SEM-PRECO',
    );
    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?pageSize=101`)
      .set('Authorization', bearer(token))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .expect(401);
  });

  it('matches across developments only when unrestricted and marks the selected unit without boosting it', async () => {
    const development = await prisma.development.create({
      data: {
        organizationId: fixture.organization.id,
        companyId: fixture.company.id,
        name: 'Outro empreendimento',
        type: 'PREDIO',
        status: 'EM_OBRA',
        city: 'São Paulo',
      },
    });
    const table = await prisma.priceTable.create({
      data: {
        organizationId: fixture.organization.id,
        developmentId: development.id,
        name: 'Tabela outro empreendimento',
        phase: 'Lançamento',
        active: true,
      },
    });
    const unit = await prisma.unit.create({
      data: {
        organizationId: fixture.organization.id,
        developmentId: development.id,
        identifier: 'OUTRO-1',
        category: 'APARTAMENTO',
        status: 'DISPONIVEL',
      },
    });
    await prisma.unitPrice.create({
      data: {
        organizationId: fixture.organization.id,
        unitId: unit.id,
        priceTableId: table.id,
        value: 260000,
      },
    });
    await prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        developmentId: fixture.development.id,
        unitId: fixture.units[0].id,
      },
    });
    const restricted = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(restricted.body.data.map((item) => item.unit.id)).not.toContain(
      unit.id,
    );
    const profile = await prisma.opportunityPropertyInterest.findUniqueOrThrow({
      where: { opportunityId },
    });
    await prisma.opportunityPropertyInterest.update({
      where: { id: profile.id },
      data: { developmentId: null, unitTypeId: null },
    });
    const unrestricted = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(unrestricted.body.data.map((item) => item.unit.id)).toContain(
      unit.id,
    );
    expect(
      unrestricted.body.data.find(
        (item) => item.unit.id === fixture.units[0].id,
      ).unit.isSelected,
    ).toBe(true);
    expect(
      unrestricted.body.data.find((item) => item.unit.id === unit.id).unit
        .isSelected,
    ).toBe(false);
    expect(
      unrestricted.body.data.find((item) => item.unit.id === unit.id).criteria,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BEDROOMS', status: 'NOT_EVALUATED' }),
        expect.objectContaining({ code: 'AREA', status: 'NOT_EVALUATED' }),
      ]),
    );
  });

  it('scores globally before pagination, explains partial matches, and never boosts the selected unit', async () => {
    const [ideal, partial] = await Promise.all([
      prisma.unit.create({
        data: {
          organizationId: fixture.organization.id,
          developmentId: fixture.development.id,
          unitTypeId: fixture.unitType.id,
          identifier: 'SCORE-A',
          category: 'APARTAMENTO',
          status: 'DISPONIVEL',
          builtArea: 80,
        },
      }),
      prisma.unit.create({
        data: {
          organizationId: fixture.organization.id,
          developmentId: fixture.development.id,
          unitTypeId: fixture.unitType.id,
          identifier: 'SCORE-B',
          category: 'APARTAMENTO',
          status: 'DISPONIVEL',
          builtArea: 65,
        },
      }),
    ]);
    await prisma.unitPrice.createMany({
      data: [
        {
          organizationId: fixture.organization.id,
          unitId: ideal.id,
          priceTableId: fixture.priceTable.id,
          value: 490000,
        },
        {
          organizationId: fixture.organization.id,
          unitId: partial.id,
          priceTableId: fixture.priceTable.id,
          value: 510000,
        },
      ],
    });
    await prisma.opportunityPropertyInterest.update({
      where: { opportunityId },
      data: {
        developmentId: fixture.development.id,
        unitTypeId: fixture.unitType.id,
        minBedrooms: 2,
        maxBedrooms: 2,
        minArea: 70,
        maxArea: 90,
        minPrice: null,
        maxPrice: '500000.00',
      },
    });
    await prisma.opportunity.update({
      where: { id: opportunityId },
      data: { unitId: partial.id },
    });
    const first = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?page=1&pageSize=1`)
      .set('Authorization', bearer(readerToken))
      .expect(200);
    const all = [...first.body.data];
    for (let page = 2; page <= first.body.pagination.totalPages; page++) {
      const response = await request(app.getHttpServer())
        .get(
          `/crm/opportunities/${opportunityId}/unit-matches?page=${page}&pageSize=1`,
        )
        .set('Authorization', bearer(readerToken))
        .expect(200);
      all.push(...response.body.data);
    }
    expect(new Set(all.map((item) => item.unit.id)).size).toBe(
      first.body.pagination.total,
    );
    expect(all.map((item) => item.compatibilityScore)).toEqual(
      [...all.map((item) => item.compatibilityScore)].sort((a, b) => b - a),
    );
    const idealResult = all.find((item) => item.unit.id === ideal.id);
    const partialResult = all.find((item) => item.unit.id === partial.id);
    expect(idealResult).toMatchObject({
      compatibilityScore: 100,
      compatibilityLevel: 'EXCELENTE',
    });
    expect(partialResult.compatibilityScore).toBeLessThan(
      idealResult.compatibilityScore,
    );
    expect(partialResult.unit.isSelected).toBe(true);
    expect(partialResult.scoreFactors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterion: 'PRICE',
          criterionScore: 80,
          status: 'MISMATCH',
        }),
        expect.objectContaining({ criterion: 'AREA', status: 'MISMATCH' }),
      ]),
    );
    await prisma.opportunity.update({
      where: { id: opportunityId },
      data: { unitId: ideal.id },
    });
    const afterSelection = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?pageSize=10`)
      .set('Authorization', bearer(readerToken))
      .expect(200);
    expect(
      afterSelection.body.data.map((item) => [
        item.unit.id,
        item.compatibilityScore,
      ]),
    ).toEqual(all.map((item) => [item.unit.id, item.compatibilityScore]));

    await prisma.opportunityPropertyInterest.update({
      where: { opportunityId },
      data: {
        minBedrooms: null,
        maxBedrooms: null,
        minArea: null,
        maxArea: null,
        minPrice: null,
        maxPrice: null,
      },
    });
    const unevaluated = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches?pageSize=10`)
      .set('Authorization', bearer(readerToken))
      .expect(200);
    expect(unevaluated.body.data[0]).toMatchObject({
      compatibilityScore: null,
      compatibilityLevel: 'NOT_EVALUATED',
      evaluatedWeight: 0,
    });
  });

  it('requires CRM_READ even for a valid user', async () => {
    const finance = await prisma.user.create({
      data: {
        organizationId: fixture.organization.id,
        name: 'Financeiro sem CRM',
        email: `finance-match-${Date.now()}@e2e.harpia.local`,
        password: fixture.commercial.password,
        role: 'FINANCEIRO',
      },
    });
    const financeToken = await login(app, finance.email);
    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/unit-matches`)
      .set('Authorization', bearer(financeToken))
      .expect(403);
  });
});
