/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantFixture } from './factories/tenant.factory';
import { createE2eApplication } from './setup/e2e-app';
import { bearer, futureIso, login } from './setup/http';

describe('CRM concurrency and transactions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Awaited<ReturnType<typeof createTenantFixture>>;
  let token: string;
  let stages: Record<string, string>;
  let documentSequence = 10000000000;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApplication());
    fixture = await createTenantFixture(prisma, {
      unitCount: 4,
      label: 'integrity',
    });
    token = await login(app, fixture.commercial.email);
    const pipelines = await request(app.getHttpServer())
      .get('/crm/pipelines')
      .set('Authorization', bearer(token))
      .expect(200);
    stages = Object.fromEntries(
      pipelines.body[0].stages.map((stage: { code: string; id: string }) => [
        stage.code,
        stage.id,
      ]),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function createPersonAndOpportunity(unitId?: string) {
    documentSequence += 1;
    const person = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(token))
      .send({
        name: `Cliente ${documentSequence}`,
        documentType: 'CPF',
        document: String(documentSequence),
        personType: 'FISICA',
      })
      .expect(201);
    const opportunity = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(token))
      .send({
        personId: person.body.id,
        developmentId: fixture.development.id,
        ...(unitId ? { unitId } : {}),
        source: 'Integridade E2E',
      })
      .expect(201);
    return {
      personId: person.body.id as string,
      opportunityId: opportunity.body.id as string,
    };
  }

  it('permite apenas uma reserva concorrente da mesma unidade', async () => {
    const unit = fixture.units[0];
    const first = await createPersonAndOpportunity();
    const second = await createPersonAndOpportunity();
    const expiresAt = futureIso(5);

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', bearer(token))
        .send({
          unitId: unit.id,
          personId: first.personId,
          opportunityId: first.opportunityId,
          expiresAt,
        }),
      request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', bearer(token))
        .send({
          unitId: unit.id,
          personId: second.personId,
          opportunityId: second.opportunityId,
          expiresAt,
        }),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(
      await prisma.unitReservation.count({
        where: {
          organizationId: fixture.organization.id,
          unitId: unit.id,
          status: 'ATIVA',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.unitReservation.count({
        where: { organizationId: fixture.organization.id, unitId: unit.id },
      }),
    ).toBe(1);
    expect(
      await prisma.unit.findUniqueOrThrow({ where: { id: unit.id } }),
    ).toMatchObject({ status: 'RESERVADA' });
  });

  it('reverte a mudança de etapa quando a venda falha após iniciar a transação', async () => {
    const duplicateSaleNumber = 'E2E-DUPLICATE-001';
    await prisma.sale.create({
      data: {
        organizationId: fixture.organization.id,
        developmentId: fixture.development.id,
        unitId: fixture.units[1].id,
        saleNumber: duplicateSaleNumber,
        saleDate: new Date(),
        grossAmount: '1.00',
        discountAmount: '0.00',
        netAmount: '1.00',
        createdByUserId: fixture.commercial.id,
      },
    });

    const targetUnit = fixture.units[2];
    const target = await createPersonAndOpportunity(targetUnit.id);
    const reservation = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', bearer(token))
      .send({
        unitId: targetUnit.id,
        personId: target.personId,
        opportunityId: target.opportunityId,
        expiresAt: futureIso(5),
      })
      .expect(201);
    const proposal = await request(app.getHttpServer())
      .post('/proposals')
      .set('Authorization', bearer(token))
      .send({
        personId: target.personId,
        unitId: targetUnit.id,
        opportunityId: target.opportunityId,
        reservationId: reservation.body.id,
        discount: '0.00',
        validUntil: futureIso(10),
        conditions: [
          {
            type: 'PARCELAS',
            amount: '250000.00',
            installments: 5,
            firstDueDate: futureIso(30),
          },
        ],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/proposals/${proposal.body.id}/send`)
      .set('Authorization', bearer(token))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/proposals/${proposal.body.id}/accept`)
      .set('Authorization', bearer(token))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/crm/opportunities/${target.opportunityId}/move`)
      .set('Authorization', bearer(token))
      .send({ stageId: stages.QUALIFICADO })
      .expect(201);
    const historyBefore = await prisma.opportunityStageHistory.count({
      where: { opportunityId: target.opportunityId },
    });

    await request(app.getHttpServer())
      .post(`/proposals/${proposal.body.id}/convert-to-sale`)
      .set('Authorization', bearer(token))
      .send({
        saleNumber: duplicateSaleNumber,
        buyers: [
          {
            personId: target.personId,
            participationPercentage: '100.00',
            isPrimary: true,
          },
        ],
      })
      .expect(409);

    expect(
      await prisma.sale.count({ where: { proposalId: proposal.body.id } }),
    ).toBe(0);
    expect(
      await prisma.opportunity.findUniqueOrThrow({
        where: { id: target.opportunityId },
      }),
    ).toMatchObject({ stageId: stages.QUALIFICADO });
    expect(
      await prisma.opportunityStageHistory.count({
        where: { opportunityId: target.opportunityId },
      }),
    ).toBe(historyBefore);
    expect(
      await prisma.salesProposal.findUniqueOrThrow({
        where: { id: proposal.body.id },
      }),
    ).toMatchObject({ convertedToSaleAt: null });
    expect(
      await prisma.unit.findUniqueOrThrow({ where: { id: targetUnit.id } }),
    ).toMatchObject({ status: 'RESERVADA' });
  });
});
