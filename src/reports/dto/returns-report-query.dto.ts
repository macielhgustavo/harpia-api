import { ReturnStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ReportPeriodQueryDto } from './report-period-query.dto';

export class ReturnsReportQueryDto extends ReportPeriodQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  developmentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  investorId?: string;

  @IsOptional()
  @IsEnum(ReturnStatus, {
    message: 'status deve ser um dos valores: PENDENTE, PAGO, ATRASADO',
  })
  status?: ReturnStatus;
}
