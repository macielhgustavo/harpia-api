import 'reflect-metadata';
import type { Response } from 'express';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { ReportFormat } from './dto/report-format-query.dto';
import { GeneratedReport, ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

const USER = {
  id: 'user-a',
  email: 'user@example.com',
  organizationId: 'organization-a',
};

describe('ReportsController', () => {
  let reportsService: ReportsServiceMock;
  let controller: ReportsController;

  beforeEach(() => {
    reportsService = createReportsServiceMock();
    controller = new ReportsController(
      reportsService as unknown as ReportsService,
    );
  });

  it('passes the authenticated organization to captations and sends secure Excel headers', async () => {
    const report = xlsxReport();
    reportsService.captations.mockResolvedValue(report);
    const response = responseMock();
    const query = { format: ReportFormat.XLSX };

    const result = await controller.captations(USER, query, response.value);

    expect(result).toBeUndefined();
    expect(reportsService.captations).toHaveBeenCalledWith(
      USER.organizationId,
      query,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      report.contentType,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="harpia-captacoes-\d{4}-\d{2}-\d{2}\.xlsx"$/,
      ),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.send).toHaveBeenCalledWith(report.buffer);
  });

  it('passes the authenticated organization to returns and sends PDF headers', async () => {
    const report = pdfReport();
    reportsService.returns.mockResolvedValue(report);
    const response = responseMock();
    const query = { format: ReportFormat.PDF };

    const result = await controller.returns(USER, query, response.value);

    expect(result).toBeUndefined();
    expect(reportsService.returns).toHaveBeenCalledWith(
      USER.organizationId,
      query,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="harpia-retornos-\d{4}-\d{2}-\d{2}\.pdf"$/,
      ),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.send).toHaveBeenCalledWith(report.buffer);
  });

  it('passes the authenticated organization to overdue return reports', async () => {
    reportsService.overdueReturns.mockResolvedValue(xlsxReport());
    const response = responseMock();
    const query = { format: ReportFormat.XLSX, asOfDate: '2026-08-10' };

    await controller.overdueReturns(USER, query, response.value);

    expect(reportsService.overdueReturns).toHaveBeenCalledWith(
      USER.organizationId,
      query,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
  });

  it('passes the authenticated organization to investor position reports', async () => {
    reportsService.investorPositions.mockResolvedValue(xlsxReport());
    const response = responseMock();
    const query = { format: ReportFormat.XLSX, investorId: 'investor-a' };

    await controller.investorPositions(USER, query, response.value);

    expect(reportsService.investorPositions).toHaveBeenCalledWith(
      USER.organizationId,
      query,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="harpia-posicao-por-investidor-\d{4}-\d{2}-\d{2}\.xlsx"$/,
      ),
    );
  });

  it('does not mark the reports controller or any report route as public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ReportsController)).not.toBe(
      true,
    );

    const routes: Array<keyof ReportsController> = [
      'captations',
      'returns',
      'overdueReturns',
      'investorPositions',
    ];
    for (const route of routes) {
      const handler = ReportsController.prototype[route];
      expect(typeof handler).toBe('function');
      if (typeof handler === 'function') {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
      }
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, ReportsController.prototype, route),
      ).not.toBe(true);
    }
  });
});

interface ReportsServiceMock {
  captations: ReportMethod;
  returns: ReportMethod;
  overdueReturns: ReportMethod;
  investorPositions: ReportMethod;
}

type ReportMethod = jest.Mock<Promise<GeneratedReport>, [string, unknown]>;

function createReportsServiceMock(): ReportsServiceMock {
  return {
    captations: jest.fn<Promise<GeneratedReport>, [string, unknown]>(),
    returns: jest.fn<Promise<GeneratedReport>, [string, unknown]>(),
    overdueReturns: jest.fn<Promise<GeneratedReport>, [string, unknown]>(),
    investorPositions: jest.fn<Promise<GeneratedReport>, [string, unknown]>(),
  };
}

function responseMock(): {
  value: Response;
  setHeader: jest.Mock<void, [string, string]>;
  send: jest.Mock<Response, [Buffer]>;
} {
  const setHeader = jest.fn<void, [string, string]>();
  const send = jest.fn<Response, [Buffer]>();
  return {
    value: { setHeader, send } as unknown as Response,
    setHeader,
    send,
  };
}

function xlsxReport(): GeneratedReport {
  return {
    buffer: Buffer.from('xlsx'),
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}

function pdfReport(): GeneratedReport {
  return {
    buffer: Buffer.from('%PDF'),
    contentType: 'application/pdf',
    extension: 'pdf',
  };
}
