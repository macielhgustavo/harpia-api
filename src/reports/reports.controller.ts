import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
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

@RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('captations')
  async captations(
    @CurrentUser() user: AuthUser,
    @Query() query: CaptationsReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const report = await this.reportsService.captations(
      user.organizationId,
      query,
    );
    this.send(response, report, 'captacoes');
  }

  @Get('returns')
  async returns(
    @CurrentUser() user: AuthUser,
    @Query() query: ReturnsReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const report = await this.reportsService.returns(
      user.organizationId,
      query,
    );
    this.send(response, report, 'retornos');
  }

  @Get('overdue-returns')
  async overdueReturns(
    @CurrentUser() user: AuthUser,
    @Query() query: OverdueReturnsReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const report = await this.reportsService.overdueReturns(
      user.organizationId,
      query,
    );
    this.send(response, report, 'retornos-em-atraso');
  }

  @Get('investor-positions')
  async investorPositions(
    @CurrentUser() user: AuthUser,
    @Query() query: InvestorPositionsReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const report = await this.reportsService.investorPositions(
      user.organizationId,
      query,
    );
    this.send(response, report, 'posicao-por-investidor');
  }

  private send(
    response: Response,
    report: GeneratedReport,
    reportName: string,
  ): void {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `harpia-${reportName}-${date}.${report.extension}`;

    response.setHeader('Content-Type', report.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(report.buffer);
  }
}
