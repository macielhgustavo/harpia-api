import { BadRequestException } from '@nestjs/common';
import {
  assertStrongPassword,
  getPasswordPolicyViolations,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './password-policy';

describe('password policy', () => {
  const email = 'user@example.com';

  it('accepts a password that meets every requirement', () => {
    expect(() => assertStrongPassword('SenhaForte1!', email)).not.toThrow();
  });

  it('reports every required character-class and length violation', () => {
    expect(getPasswordPolicyViolations('short', email)).toEqual(
      expect.arrayContaining([
        `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
        'A senha deve conter uma letra maiúscula.',
        'A senha deve conter um número.',
        'A senha deve conter um caractere especial.',
      ]),
    );
  });

  it('identifies each missing character class independently', () => {
    expect(getPasswordPolicyViolations('senhaforte1!', email)).toContain(
      'A senha deve conter uma letra maiúscula.',
    );
    expect(getPasswordPolicyViolations('SENHAFORTE1!', email)).toContain(
      'A senha deve conter uma letra minúscula.',
    );
    expect(getPasswordPolicyViolations('SenhaForte!!', email)).toContain(
      'A senha deve conter um número.',
    );
    expect(getPasswordPolicyViolations('SenhaForte12', email)).toContain(
      'A senha deve conter um caractere especial.',
    );
  });

  it('rejects whitespace-only, surrounding whitespace, long and e-mail-derived passwords', () => {
    expect(getPasswordPolicyViolations('          ', email)).toContain(
      'A senha não pode conter apenas espaços.',
    );
    expect(getPasswordPolicyViolations(' SenhaForte1!', email)).toContain(
      'A senha não pode começar ou terminar com espaços.',
    );
    expect(
      getPasswordPolicyViolations(
        `Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH)}`,
        email,
      ),
    ).toContain(
      `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    );
    expect(getPasswordPolicyViolations('User@Example.com1!', email)).toContain(
      'A senha não pode ser igual ou conter o e-mail completo.',
    );
  });

  it('rejects passwords that bcrypt would silently truncate', () => {
    const longUtf8Password = `SenhaForte1!${'á'.repeat(40)}`;

    expect(getPasswordPolicyViolations(longUtf8Password, email)).toContain(
      'A senha excede o limite seguro de 72 bytes em UTF-8 para bcrypt.',
    );
  });

  it('returns a clear bad-request response to callers', () => {
    expect(() => assertStrongPassword('short', email)).toThrow(
      BadRequestException,
    );
  });
});
