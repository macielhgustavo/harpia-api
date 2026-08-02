import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { ReportFormatQueryDto } from './report-format-query.dto';
import { ISO_DATE_PATTERN } from './report-period-query.dto';

export class OverdueReturnsReportQueryDto extends ReportFormatQueryDto {
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN, {
    message: 'asOfDate deve estar no formato YYYY-MM-DD',
  })
  @IsDateString({}, { message: 'asOfDate deve ser uma data v\u00e1lida' })
  asOfDate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  developmentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  investorId?: string;
}
