import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normalizeEmail } from '../email.utils';

export class ForgotPasswordDto {
  @Transform(({ value }) => {
    const input: unknown = value;
    return typeof input === 'string' ? normalizeEmail(input) : input;
  })
  @IsEmail()
  @MaxLength(254)
  email: string;
}
