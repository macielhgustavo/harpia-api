import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ReportPeriodQueryDto } from './report-period-query.dto';

export class CaptationsReportQueryDto extends ReportPeriodQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  developmentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  investorId?: string;
}
