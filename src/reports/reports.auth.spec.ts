import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController authentication', () => {
  let app: INestApplication;
  const reportsService = {
    captations: jest.fn(),
    returns: jest.fn(),
    overdueReturns: jest.fn(),
    investorPositions: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'reports-test-secret' })],
        }),
        PassportModule,
      ],
      controllers: [ReportsController],
      providers: [
        JwtStrategy,
        { provide: ReportsService, useValue: reportsService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 before reaching a financial report route without a JWT', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .get('/reports/captations?format=xlsx')
      .expect(401);

    expect(reportsService.captations).not.toHaveBeenCalled();
  });
});
