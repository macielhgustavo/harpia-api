import { ConfigService } from '@nestjs/config';

export function getAuthConfigInteger(
  configService: ConfigService,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const rawValue = configService.get<string>(key);

  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} deve ser um número inteiro entre ${min} e ${max}.`);
  }

  return value;
}
