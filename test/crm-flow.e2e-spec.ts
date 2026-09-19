/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import request from 'supertest';
import { AUDIT_ACTIONS } from '../src/audit/audit-events';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantFixture } from './factories/tenant.factory';
import { createE2eApplication } from './setup/e2e-app';
import { bearer, futureIso, login } from './setup/http';

describe('CRM commercial flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Awaited<ReturnType<typeof createTenantFixture>>;
  let token: string;
  let stages: Record<string, string>;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApplication());
    fixture = await createTenantFixture(prisma, {
      unitCount: 3,
      label: 'flow',
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

  it('persiste Pessoa → Oportunidade → Atividade → Visita → Reserva → Proposta → Venda', async () => {
    const personResponse = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(token))
      .send({
        name: 'João Silva',
        documentType: 'CPF',
        document: '39053344705',
        personType: 'FISICA',
        email: 'joao.silva@example.test',
        roles: ['LEAD'],
      })
      .expect(201);
    const personId = personResponse.body.id as string;
    expect(personResponse.body.organizationId).toBe(fixture.organization.id);

    const opportunityResponse = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(token))
      .send({
        personId,
        assignedUserId: fixture.commercial.id,
        developmentId: fixture.development.id,
        source: 'Campanha Aurora',
        estimatedValue: '245000.00',
      })
      .expect(201);
    const opportunityId = opportunityResponse.body.id as string;
    const initialStageEnteredAt = opportunityResponse.body
      .stageEnteredAt as string;
    expect(opportunityResponse.body.stage.code).toBe('NOVO');
    expect(opportunityResponse.body.unitId).toBeNull();

    const initialHistory = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/history`)
      .query({ page: 1, pageSize: 20 })
      .set('Authorization', bearer(token))
      .expect(200);
    expect(initialHistory.body.pagination.total).toBe(1);
    expect(initialHistory.body.data[0]).toMatchObject({
      fromStageId: null,
      toStageId: stages.NOVO,
      changedByUserId: fixture.commercial.id,
    });

    const leadRoles = await prisma.personRole.count({
      where: { personId, role: 'LEAD' },
    });
    expect(leadRoles).toBe(1);

    const activityResponse = await request(app.getHttpServer())
      .post('/crm/activities')
      .set('Authorization', bearer(token))
      .send({
        opportunityId,
        assignedUserId: fixture.commercial.id,
        type: 'FOLLOW_UP',
        priority: 'ALTA',
        scheduledAt: futureIso(1),
        summary: 'Retornar contato sobre o Residencial Aurora',
      })
      .expect(201);
    const activityId = activityResponse.body.id as string;
    expect(activityResponse.body).toMatchObject({
      opportunityId,
      personId,
      assignedUserId: fixture.commercial.id,
      status: 'PENDENTE',
    });

    const visitResponse = await request(app.getHttpServer())
      .post('/crm/visits')
      .set('Authorization', bearer(token))
      .send({
        opportunityId,
        assignedUserId: fixture.commercial.id,
        developmentId: fixture.development.id,
        scheduledAt: futureIso(2),
        durationMinutes: 60,
        location: 'Stand do Residencial Aurora',
      })
      .expect(201);
    const visitId = visitResponse.body.id as string;
    expect(visitResponse.body.status).toBe('AGENDADA');

    const completedVisit = await request(app.getHttpServer())
      .patch(`/crm/visits/${visitId}`)
      .set('Authorization', bearer(token))
      .send({
        status: 'REALIZADA',
        outcome: 'INTERESSE_ALTO',
        result: 'Cliente escolheu a unidade apresentada',
      })
      .expect(200);
    expect(completedVisit.body).toMatchObject({
      status: 'REALIZADA',
      outcome: 'INTERESSE_ALTO',
    });
    expect(completedVisit.body.completedAt).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .patch(`/crm/visits/${visitId}`)
      .set('Authorization', bearer(token))
      .send({ status: 'CANCELADA', cancellationReason: 'Alteração tardia' })
      .expect(409);

    const selectedUnit = fixture.units[0];
    const opportunityWithUnit = await request(app.getHttpServer())
      .patch(`/crm/opportunities/${opportunityId}`)
      .set('Authorization', bearer(token))
      .send({
        developmentId: fixture.development.id,
        unitId: selectedUnit.id,
      })
      .expect(200);
    expect(opportunityWithUnit.body.unit).toMatchObject({
      id: selectedUnit.id,
      developmentId: fixture.development.id,
    });

    const reservationResponse = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', bearer(token))
      .send({
        unitId: selectedUnit.id,
        personId,
        opportunityId,
        expiresAt: futureIso(7),
        notes: 'Reserva do cenário comercial E2E',
      })
      .expect(201);
    const reservationId = reservationResponse.body.id as string;
    expect(reservationResponse.body.status).toBe('ATIVA');
    expect(
      await prisma.unit.findUniqueOrThrow({ where: { id: selectedUnit.id } }),
    ).toMatchObject({ status: 'RESERVADA' });
    expect(
      await prisma.unitReservation.count({
        where: { unitId: selectedUnit.id, status: 'ATIVA' },
      }),
    ).toBe(1);

    const proposalResponse = await request(app.getHttpServer())
      .post('/proposals')
      .set('Authorization', bearer(token))
      .send({
        personId,
        unitId: selectedUnit.id,
        opportunityId,
        reservationId,
        discount: '5000.00',
        validUntil: futureIso(10),
        notes: 'Condição negociada no cenário E2E',
        conditions: [
          {
            type: 'ENTRADA',
            amount: '45000.00',
            firstDueDate: futureIso(15),
          },
          {
            type: 'PARCELAS',
            amount: '200000.00',
            installments: 4,
            firstDueDate: futureIso(45),
            intervalMonths: 1,
          },
        ],
      })
      .expect(201);
    const proposalId = proposalResponse.body.id as string;
    expect(proposalResponse.body.currentVersion.version).toBe(1);
    expect(Number(proposalResponse.body.currentVersion.basePrice)).toBe(250000);
    expect(Number(proposalResponse.body.currentVersion.discount)).toBe(5000);
    expect(Number(proposalResponse.body.currentVersion.finalPrice)).toBe(
      245000,
    );
    expect(proposalResponse.body.currentVersion.sourcePriceTableId).toBe(
      fixture.priceTable.id,
    );

    await request(app.getHttpServer())
      .post(`/proposals/${proposalId}/send`)
      .set('Authorization', bearer(token))
      .expect(201);
    const acceptedProposal = await request(app.getHttpServer())
      .post(`/proposals/${proposalId}/accept`)
      .set('Authorization', bearer(token))
      .expect(201);
    expect(acceptedProposal.body.status).toBe('ACEITA');
    expect(acceptedProposal.body.reservation.status).toBe('CONVERTIDA');

    const wonOpportunity = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(wonOpportunity.body.stage.code).toBe('GANHO');
    expect(
      new Date(wonOpportunity.body.stageEnteredAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(initialStageEnteredAt).getTime());

    const wonHistory = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunityId}/history`)
      .query({ page: 1, pageSize: 20 })
      .set('Authorization', bearer(token))
      .expect(200);
    expect(wonHistory.body.pagination.total).toBe(2);
    expect(
      wonHistory.body.data.filter(
        (entry: { toStageId: string }) => entry.toStageId === stages.GANHO,
      ),
    ).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: fixture.organization.id,
          entityId: opportunityId,
          action: AUDIT_ACTIONS.OPPORTUNITY_WON,
        },
      }),
    ).toBe(1);

    const saleResponse = await request(app.getHttpServer())
      .post(`/proposals/${proposalId}/convert-to-sale`)
      .set('Authorization', bearer(token))
      .send({
        saleNumber: 'E2E-MAIN-001',
        saleDate: new Date().toISOString(),
        buyers: [
          {
            personId,
            participationPercentage: '100.00',
            isPrimary: true,
          },
        ],
      })
      .expect(201);
    const saleId = saleResponse.body.id as string;
    expect(saleResponse.body).toMatchObject({
      opportunityId,
      proposalId,
      unitId: selectedUnit.id,
      saleNumber: 'E2E-MAIN-001',
      status: 'ATIVA',
    });
    expect(Number(saleResponse.body.grossAmount)).toBe(250000);
    expect(Number(saleResponse.body.discountAmount)).toBe(5000);
    expect(Number(saleResponse.body.netAmount)).toBe(245000);
    expect(Number(saleResponse.body.outstandingBalance)).toBe(245000);
    expect(saleResponse.body.receivables).toHaveLength(5);

    const persistedSale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { receivables: true, proposal: true, unit: true },
    });
    expect(persistedSale.netAmount.toFixed(2)).toBe('245000.00');
    expect(persistedSale.receivables).toHaveLength(5);
    expect(
      persistedSale.receivables
        .reduce(
          (sum, receivable) => sum.plus(receivable.originalAmount),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
    ).toBe('245000.00');
    expect(persistedSale.proposal?.convertedToSaleAt).not.toBeNull();
    expect(persistedSale.unit.status).toBe('VENDIDA');

    const timelineEvents: Array<{
      id: string;
      type: string;
      occurredAt: string;
    }> = [];
    let cursor: string | null = null;
    do {
      const timeline = await request(app.getHttpServer())
        .get(`/crm/opportunities/${opportunityId}/timeline`)
        .query({ limit: 3, ...(cursor ? { cursor } : {}) })
        .set('Authorization', bearer(token))
        .expect(200);
      timelineEvents.push(...timeline.body.data);
      cursor = timeline.body.nextCursor as string | null;
    } while (cursor);

    expect(new Set(timelineEvents.map((event) => event.id)).size).toBe(
      timelineEvents.length,
    );
    expect(new Set(timelineEvents.map((event) => event.type))).toEqual(
      new Set([
        'STAGE_CHANGED',
        'ACTIVITY',
        'VISIT',
        'RESERVATION',
        'PROPOSAL',
        'SALE',
      ]),
    );
    expect(timelineEvents.map((event) => event.id)).toEqual(
      expect.arrayContaining([
        `activity:${activityId}`,
        `visit:${visitId}`,
        `reservation:${reservationId}`,
        `proposal:${proposalId}`,
        `sale:${saleId}`,
      ]),
    );
    for (let index = 1; index < timelineEvents.length; index += 1) {
      expect(
        new Date(timelineEvents[index - 1].occurredAt).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(timelineEvents[index].occurredAt).getTime(),
      );
    }
  });

  it('preserva o motivo de perda no histórico e timeline após reabertura', async () => {
    const person = await request(app.getHttpServer())
      .post('/people')
      .set('Authorization', bearer(token))
      .send({
        name: 'Maria Motivo Histórico',
        documentType: 'CPF',
        document: '52998224725',
        personType: 'FISICA',
      })
      .expect(201);
    const opportunity = await request(app.getHttpServer())
      .post('/crm/opportunities')
      .set('Authorization', bearer(token))
      .send({ personId: person.body.id, source: 'Teste lostReason' })
      .expect(201);

    const lost = await request(app.getHttpServer())
      .post(`/crm/opportunities/${opportunity.body.id}/move`)
      .set('Authorization', bearer(token))
      .send({ stageId: stages.PERDIDO, lostReason: '  Preço  ' })
      .expect(201);
    expect(lost.body.lostReason).toBe('Preço');

    const reopened = await request(app.getHttpServer())
      .post(`/crm/opportunities/${opportunity.body.id}/move`)
      .set('Authorization', bearer(token))
      .send({ stageId: stages.QUALIFICADO })
      .expect(201);
    expect(reopened.body.stage.code).toBe('QUALIFICADO');
    expect(reopened.body.lostReason).toBeNull();

    const history = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunity.body.id}/history`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(
      history.body.data.find(
        (entry: { toStageId: string }) => entry.toStageId === stages.PERDIDO,
      ),
    ).toMatchObject({ lostReason: 'Preço' });

    const timeline = await request(app.getHttpServer())
      .get(`/crm/opportunities/${opportunity.body.id}/timeline`)
      .query({ limit: 20 })
      .set('Authorization', bearer(token))
      .expect(200);
    expect(
      timeline.body.data.find(
        (event: { title: string }) =>
          event.title === 'Oportunidade marcada como perdida',
      ).description,
    ).toContain('Motivo: Preço');

    const lossAudit = await prisma.auditLog.findFirst({
      where: {
        organizationId: fixture.organization.id,
        entityId: opportunity.body.id,
        action: AUDIT_ACTIONS.OPPORTUNITY_LOST,
      },
    });
    expect((lossAudit as AuditLog).metadata).toMatchObject({
      lostReason: 'Preço',
    });
  });
});
