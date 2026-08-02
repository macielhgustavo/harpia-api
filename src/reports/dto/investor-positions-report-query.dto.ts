import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ReportFormatQueryDto } from './report-format-query.dto';

export class InvestorPositionsReportQueryDto extends ReportFormatQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  investorId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  developmentId?: string;
}
