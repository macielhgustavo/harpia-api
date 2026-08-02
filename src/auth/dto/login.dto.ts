import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { normalizeEmail } from '../email.utils';

export class LoginDto {
  @Transform(({ value }) => {
    const input: unknown = value;
    return typeof input === 'string' ? normalizeEmail(input) : input;
  })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  password: string;
}
