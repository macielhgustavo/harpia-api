import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AcceptUserInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  password!: string;
}
