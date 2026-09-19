/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { E2E_PASSWORD } from '../factories/tenant.factory';

export async function login(
  app: INestApplication,
  email: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD })
    .expect(201);
  return response.body.access_token as string;
}

export function bearer(token: string) {
  return `Bearer ${token}`;
}

export function futureIso(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
