import { Controller, Get, INestApplication } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard';

@Controller('operational-test')
class OperationalTestController {
  @Get()
  status() {
    return { ok: true };
  }
}

describe('AuthController throttling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'login', limit: 2, ttl: 60_000 },
          { name: 'register', limit: 2, ttl: 60_000 },
          { name: 'forgot', limit: 2, ttl: 60_000 },
          { name: 'reset', limit: 2, ttl: 60_000 },
        ]),
      ],
      controllers: [AuthController, OperationalTestController],
      providers: [
        AuthThrottlerGuard,
        {
          provide: AuthService,
          useValue: {
            login: jest.fn().mockResolvedValue({ access_token: 'test-token' }),
            register: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            changePassword: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after the configured public login limit', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer).post('/auth/login').send({}).expect(201);
    await request(httpServer).post('/auth/login').send({}).expect(201);
    await request(httpServer).post('/auth/login').send({}).expect(429);
  });

  it('applies its independent limit to forgot-password', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .post('/auth/forgot-password')
      .send({})
      .expect(201);
    await request(httpServer)
      .post('/auth/forgot-password')
      .send({})
      .expect(201);
    await request(httpServer)
      .post('/auth/forgot-password')
      .send({})
      .expect(429);
  });

  it('does not throttle unrelated operational routes', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer).get('/operational-test').expect(200);
    await request(httpServer).get('/operational-test').expect(200);
    await request(httpServer).get('/operational-test').expect(200);
  });
});
