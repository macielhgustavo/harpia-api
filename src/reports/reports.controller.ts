import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CaptationsReportQueryDto } from './dto/captations-report-query.dto';
import { InvestorPositionsReportQueryDto } from './dto/investor-positions-report-query.dto';
import { OverdueReturnsReportQueryDto } from './dto/overdue-returns-report-query.dto';
import { ReturnsReportQueryDto } from './dto/returns-report-query.dto';
import { GeneratedReport, ReportsService } from './reports.service';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('captations')
  async captations(
    @CurrentUser() user: AuthUser,
    @Query() query: CaptationsReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Buffer> {
    const report = await this.reportsService.captations(
      user.organizationId,
      query,
    );
    return this.send(response, report, 'captacoes');
  }

  @Get('returns')
  async returns(
    @CurrentUser() user: AuthUser,
    @Query() query: ReturnsReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Buffer> {
    const report = await this.reportsService.returns(
      user.organizationId,
      query,
    );
    return this.send(response, report, 'retornos');
  }

  @Get('overdue-returns')
  async overdueReturns(
    @CurrentUser() user: AuthUser,
    @Query() query: OverdueReturnsReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Buffer> {
    const report = await this.reportsService.overdueReturns(
      user.organizationId,
      query,
    );
    return this.send(response, report, 'retornos-em-atraso');
  }

  @Get('investor-positions')
  async investorPositions(
    @CurrentUser() user: AuthUser,
    @Query() query: InvestorPositionsReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Buffer> {
    const report = await this.reportsService.investorPositions(
      user.organizationId,
      query,
    );
    return this.send(response, report, 'posicao-por-investidor');
  }

  private send(
    response: Response,
    report: GeneratedReport,
    reportName: string,
  ): Buffer {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `harpia-${reportName}-${date}.${report.extension}`;

    response.setHeader('Content-Type', report.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    return report.buffer;
  }
}
