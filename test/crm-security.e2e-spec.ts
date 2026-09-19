/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantFixture } from './factories/tenant.factory';
import { createE2eApplication } from './setup/e2e-app';
import { bearer, futureIso, login } from './setup/http';

describe('CRM tenancy and RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: Awaited<ReturnType<typeof createTenantFixture>>;
  let tenantB: Awaited<ReturnType<typeof createTenantFixture>>;
  let tokenA: string;
  let tokenB: string;
  let readerTokenA: string;
  let opportunityAId: string;
  let personAId: string;
  let opportunityBId: string;
  let visitBId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApplication());
    tenantA = await createTenantFixture(prisma, {
      unitCount: 1,
      label: 'security-a',
    });
    tenantB = await createTenantFixture(prisma, {
      unitCount: 1,
      label: 'security-b',
    });
    [tokenA, tokenB, readerTokenA] = await Promise.all([
      login(app, tenantA.commercial.email),
      login(app, tenantB.commercial.email),
      login(app, tenantA.reader.email),
    ]);

    const personA = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(tokenA))
      .send({
        name: 'Lead Tenant A',
        documentType: 'CPF',
        document: '16899535009',
        personType: 'FISICA',
      })
      .expect(201);
    personAId = personA.body.id;
    const opportunityA = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(tokenA))
      .send({ personId: personAId, source: 'Tenant A' })
      .expect(201);
    opportunityAId = opportunityA.body.id;

    const personB = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(tokenB))
      .send({
        name: 'Lead Tenant B',
        documentType: 'CPF',
        document: '11144477735',
        personType: 'FISICA',
      })
      .expect(201);
    const opportunityB = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(tokenB))
      .send({
        personId: personB.body.id,
        developmentId: tenantB.development.id,
        unitId: tenantB.units[0].id,
        source: 'Tenant B',
      })
      .expect(201);
    opportunityBId = opportunityB.body.id;
    const visitB = await request(app.getHttpServer())
      .post('/crm/visits')
      .set('Authorization', bearer(tokenB))
      .send({
        opportunityId: opportunityBId,
        scheduledAt: futureIso(2),
      })
      .expect(201);
    visitBId = visitB.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('oculta oportunidade, visita, unidade e timeline de outro tenant', async () => {
    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityBId}`)
      .set('Authorization', bearer(tokenA))
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/crm/visits/${visitBId}`)
      .set('Authorization', bearer(tokenA))
      .send({ status: 'REALIZADA', outcome: 'INTERESSE_MEDIO' })
      .expect(404);

    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', bearer(tokenA))
      .send({
        unitId: tenantB.units[0].id,
        personId: personAId,
        opportunityId: opportunityAId,
        expiresAt: futureIso(4),
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityBId}/timeline`)
      .set('Authorization', bearer(tokenA))
      .expect(404);

    expect(
      await prisma.salesVisit.findUniqueOrThrow({ where: { id: visitBId } }),
    ).toMatchObject({ status: 'AGENDADA' });
    expect(
      await prisma.unit.findUniqueOrThrow({
        where: { id: tenantB.units[0].id },
      }),
    ).toMatchObject({ status: 'DISPONIVEL' });
  });

  it('permite CRM_READ e bloqueia CRM_WRITE para o papel LEITURA', async () => {
    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityAId}`)
      .set('Authorization', bearer(readerTokenA))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityAId}/timeline`)
      .set('Authorization', bearer(readerTokenA))
      .expect(200);

    await request(app.getHttpServer())
      .post('/crm/activities')
      .set('Authorization', bearer(readerTokenA))
      .send({
        opportunityId: opportunityAId,
        type: 'FOLLOW_UP',
        summary: 'Mutação proibida para leitura',
      })
      .expect(403);

    expect(
      await prisma.salesActivity.count({
        where: {
          organizationId: tenantA.organization.id,
          opportunityId: opportunityAId,
        },
      }),
    ).toBe(0);
  });
});
