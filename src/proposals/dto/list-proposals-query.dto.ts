import { Type } from 'class-transformer';
import { SalesProposalStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListProposalsQueryDto {
  @IsOptional() @IsString() opportunityId?: string;
  @IsOptional() @IsString() reservationId?: string;
  @IsOptional() @IsString() personId?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() developmentId?: string;
  @IsOptional() @IsEnum(SalesProposalStatus) status?: SalesProposalStatus;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
