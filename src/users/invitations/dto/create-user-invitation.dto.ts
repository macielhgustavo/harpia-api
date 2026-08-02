import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { normalizeEmail } from '../../../auth/email.utils';

export class CreateUserInvitationDto {
  @Transform(({ value }) => {
    const input: unknown = value;
    return typeof input === 'string' ? normalizeEmail(input) : input;
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
