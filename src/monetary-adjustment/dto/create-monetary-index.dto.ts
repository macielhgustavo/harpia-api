import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMonetaryIndexDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean = true;

  @IsString()
  periodicity: string; // e.g., MONTHLY, QUARTERLY, YEARLY
}
