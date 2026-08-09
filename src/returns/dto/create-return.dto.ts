import { ReturnStatus } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

const PERSISTED_RETURN_STATUSES: ReturnStatus[] = [
  ReturnStatus.PENDENTE,
  ReturnStatus.PAGO,
];

export class CreateReturnDto {
  @IsString()
  allocationId: string;

  @IsNumber()
  @IsPositive()
  expectedAmount: number;

  @IsDateString()
  expectedDate: string;

  @IsOptional()
  @IsDateString()
  realizedDate?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  realizedAmount?: number;

  @IsOptional()
  @IsIn(PERSISTED_RETURN_STATUSES)
  status?: ReturnStatus;
}
