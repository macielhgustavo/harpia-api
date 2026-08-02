import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { normalizeEmail } from './email.utils';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function getPasswordPolicyViolations(
  password: string,
  email: string,
): string[] {
  const violations: string[] = [];

  if (typeof password !== 'string') {
    return ['A senha deve ser um texto.'];
  }

  if (password.trim().length === 0) {
    violations.push('A senha não pode conter apenas espaços.');
  }

  if (password !== password.trim()) {
    violations.push('A senha não pode começar ou terminar com espaços.');
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push(
      `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    violations.push(
      `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    );
  }

  if (!/[A-Z]/.test(password)) {
    violations.push('A senha deve conter uma letra maiúscula.');
  }

  if (!/[a-z]/.test(password)) {
    violations.push('A senha deve conter uma letra minúscula.');
  }

  if (!/[0-9]/.test(password)) {
    violations.push('A senha deve conter um número.');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    violations.push('A senha deve conter um caractere especial.');
  }

  if (bcrypt.truncates(password)) {
    violations.push(
      'A senha excede o limite seguro de 72 bytes em UTF-8 para bcrypt.',
    );
  }

  const normalizedEmail = normalizeEmail(email);
  if (
    normalizedEmail.length > 0 &&
    password.toLowerCase().includes(normalizedEmail)
  ) {
    violations.push('A senha não pode ser igual ou conter o e-mail completo.');
  }

  return violations;
}

export function assertStrongPassword(password: string, email: string): void {
  const violations = getPasswordPolicyViolations(password, email);

  if (violations.length > 0) {
    throw new BadRequestException(`Senha inválida: ${violations.join(' ')}`);
  }
}
