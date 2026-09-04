import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNotificationDto {
  @IsString()
  recipientUserId: string;

  @IsString()
  @MaxLength(160)
  title: string;

  @IsString()
  @MaxLength(4000)
  message: string;

  @IsString()
  @MaxLength(80)
  type: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
