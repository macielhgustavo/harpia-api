/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AUDIT_ACTIONS } from '../src/audit/audit-events';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantFixture } from './factories/tenant.factory';
import { createE2eApplication } from './setup/e2e-app';
import { bearer, login } from './setup/http';

describe('CRM property interest profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: Awaited<ReturnType<typeof createTenantFixture>>;
  let tenantB: Awaited<ReturnType<typeof createTenantFixture>>;
  let tokenA: string;
  let tokenB: string;
  let readerTokenA: string;
  let opportunityAId: string;
  let opportunityBId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApplication());
    tenantA = await createTenantFixture(prisma, { label: 'interest-a' });
    tenantB = await createTenantFixture(prisma, { label: 'interest-b' });
    [tokenA, tokenB, readerTokenA] = await Promise.all([
      login(app, tenantA.commercial.email),
      login(app, tenantB.commercial.email),
      login(app, tenantA.reader.email),
    ]);

    const personA = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(tokenA))
      .send({
        name: 'Lead com preferências',
        documentType: 'CPF',
        document: '52998224725',
        personType: 'FISICA',
      })
      .expect(201);
    const opportunityA = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(tokenA))
      .send({ personId: personA.body.id })
      .expect(201);
    opportunityAId = opportunityA.body.id;
    expect(opportunityA.body.unitId).toBeNull();

    const personB = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(tokenB))
      .send({
        name: 'Lead de outro tenant',
        documentType: 'CPF',
        document: '11144477735',
        personType: 'FISICA',
      })
      .expect(201);
    const opportunityB = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(tokenB))
      .send({ personId: personB.body.id })
      .expect(201);
    opportunityBId = opportunityB.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, reads, replaces and removes one profile independently of the chosen unit', async () => {
    const empty = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(tokenA))
      .expect(200);
    expect(empty.text).toBe('');

    const payload = {
      developmentId: tenantA.development.id,
      unitTypeId: tenantA.unitType.id,
      minBedrooms: 2,
      maxBedrooms: 3,
      minArea: 60.5,
      maxArea: 90.5,
      minPrice: '300000.01',
      maxPrice: '500000.17',
      availableDownPayment: '80000.09',
      purpose: 'MORADIA',
      notes: '  Perto do metrô  ',
      organizationId: tenantB.organization.id,
    };
    const created = await request(app.getHttpServer())
      .put(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(tokenA))
      .send(payload)
      .expect(200);
    const interestId = created.body.id as string;
    expect(created.body).toMatchObject({
      organizationId: tenantA.organization.id,
      opportunityId: opportunityAId,
      developmentId: tenantA.development.id,
      unitTypeId: tenantA.unitType.id,
      minArea: 60.5,
      maxArea: 90.5,
      minPrice: '300000.01',
      maxPrice: '500000.17',
      availableDownPayment: '80000.09',
      purpose: 'MORADIA',
      notes: 'Perto do metrô',
    });
    expect(created.body.development.name).toContain('Residencial Aurora');
    expect(created.body.unitType.id).toBe(tenantA.unitType.id);

    const persisted =
      await prisma.opportunityPropertyInterest.findUniqueOrThrow({
        where: { opportunityId: opportunityAId },
      });
    expect(persisted.maxPrice).toBeInstanceOf(Prisma.Decimal);
    expect(persisted.maxPrice?.toFixed(2)).toBe('500000.17');
    expect(persisted.availableDownPayment?.toFixed(2)).toBe('80000.09');
    expect(persisted.organizationId).toBe(tenantA.organization.id);
    expect(
      await prisma.opportunity.findUniqueOrThrow({
        where: { id: opportunityAId },
      }),
    ).toMatchObject({ unitId: null });

    const read = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(tokenA))
      .expect(200);
    expect(read.body.id).toBe(interestId);

    const updated = await request(app.getHttpServer())
      .put(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(tokenA))
      .send({ maxPrice: '475000.25', purpose: 'INVESTIMENTO' })
      .expect(200);
    expect(updated.body).toMatchObject({
      id: interestId,
      developmentId: null,
      unitTypeId: null,
      minBedrooms: null,
      maxPrice: '475000.25',
      availableDownPayment: null,
      purpose: 'INVESTIMENTO',
    });
    expect(
      await prisma.opportunityPropertyInterest.count({
        where: { opportunityId: opportunityAId },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .patch(`/crm/opportunities/${opportunityAId}`)
      .set('Authorization', bearer(tokenA))
      .send({
        developmentId: tenantA.development.id,
        unitId: tenantA.units[0].id,
      })
      .expect(200);
    const afterSelection = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(tokenA))
      .expect(200);
    expect(afterSelection.body).toMatchObject({
      id: interestId,
      developmentId: null,
      maxPrice: '475000.25',
    });

    await request(app.getHttpServer())
      .delete(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(tokenA))
      .expect(200);
    expect(
      await prisma.opportunityPropertyInterest.count({
        where: { opportunityId: opportunityAId },
      }),
    ).toBe(0);
    expect(
      await prisma.opportunity.findUniqueOrThrow({
        where: { id: opportunityAId },
      }),
    ).toMatchObject({ unitId: tenantA.units[0].id });

    const audit = await prisma.auditLog.findMany({
      where: {
        organizationId: tenantA.organization.id,
        entityId: interestId,
        action: {
          in: [
            AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_CREATED,
            AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_UPDATED,
            AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_DELETED,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((entry) => entry.action)).toEqual([
      AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_CREATED,
      AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_UPDATED,
      AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_DELETED,
    ]);
    for (const entry of audit) {
      const metadata = entry.metadata as Record<string, unknown>;
      expect(metadata.opportunityId).toBe(opportunityAId);
      expect(metadata.notes).toBeUndefined();
      expect(metadata.maxPrice).toBeUndefined();
    }
  });

  it('rejects inverted ranges, negative money and invalid tenant relationships over HTTP', async () => {
    const endpoint = `/crm/opportunities/${opportunityAId}/interest`;
    for (const payload of [
      { minPrice: '500000.01', maxPrice: '500000.00' },
      { minArea: 90, maxArea: 70 },
      { minBedrooms: 3, maxBedrooms: 2 },
      { minBedrooms: -1 },
      { availableDownPayment: '-1.00' },
      { developmentId: tenantB.development.id },
      {
        developmentId: tenantA.development.id,
        unitTypeId: tenantB.unitType.id,
      },
      { unitTypeId: tenantA.unitType.id },
    ]) {
      await request(app.getHttpServer())
        .put(endpoint)
        .set('Authorization', bearer(tokenA))
        .send(payload)
        .expect(400);
    }
    expect(
      await prisma.opportunityPropertyInterest.count({
        where: { opportunityId: opportunityAId },
      }),
    ).toBe(0);
  });

  it('enforces CRM_READ/CRM_WRITE and hides profiles across tenants', async () => {
    const endpointB = `/crm/opportunities/${opportunityBId}/interest`;
    await request(app.getHttpServer())
      .put(endpointB)
      .set('Authorization', bearer(tokenB))
      .send({ maxPrice: '400000.00' })
      .expect(200);

    await request(app.getHttpServer())
      .get(endpointB)
      .set('Authorization', bearer(tokenA))
      .expect(404);
    await request(app.getHttpServer())
      .put(endpointB)
      .set('Authorization', bearer(tokenA))
      .send({ maxPrice: '1.00' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(endpointB)
      .set('Authorization', bearer(tokenA))
      .expect(404);

    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(readerTokenA))
      .expect(200);
    await request(app.getHttpServer())
      .put(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(readerTokenA))
      .send({ maxPrice: '1.00' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/crm/opportunities/${opportunityAId}/interest`)
      .set('Authorization', bearer(readerTokenA))
      .expect(403);

    expect(
      await prisma.opportunityPropertyInterest.findUniqueOrThrow({
        where: { opportunityId: opportunityBId },
      }),
    ).toMatchObject({
      organizationId: tenantB.organization.id,
      maxPrice: new Prisma.Decimal('400000.00'),
    });
  });
});
