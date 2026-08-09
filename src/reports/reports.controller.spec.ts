import 'reflect-metadata';
import type { Response } from 'express';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import type { AuditService } from '../audit/audit.service';
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
  let auditService: ReturnType<typeof createAuditServiceMock>;
  let controller: ReportsController;

  beforeEach(() => {
    reportsService = createReportsServiceMock();
    auditService = createAuditServiceMock();
    controller = new ReportsController(
      reportsService as unknown as ReportsService,
      auditService as unknown as AuditService,
    );
  });

  it('passes the authenticated organization to captations and sends secure Excel headers', async () => {
    const report = xlsxReport();
    reportsService.captations.mockResolvedValue(report);
    const response = responseMock();
    const query = {
      format: ReportFormat.XLSX,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      developmentId: 'development-a',
    };

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
    expect(auditService.record).toHaveBeenCalledWith({
      organizationId: USER.organizationId,
      actorUserId: USER.id,
      action: AUDIT_ACTIONS.REPORT_EXPORTED,
      entityType: AUDIT_ENTITY_TYPES.REPORT,
      entityId: 'captations',
      metadata: {
        reportType: 'captations',
        format: ReportFormat.XLSX,
        filters: {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          developmentId: 'development-a',
          investorId: undefined,
        },
      },
    });
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
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: USER.id,
        entityId: 'returns',
        metadata: {
          reportType: 'returns',
          format: ReportFormat.PDF,
          filters: {
            startDate: undefined,
            endDate: undefined,
            developmentId: undefined,
            investorId: undefined,
            status: undefined,
          },
        },
      }),
    );
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
    expect(auditService.record).toHaveBeenCalledWith({
      organizationId: USER.organizationId,
      actorUserId: USER.id,
      action: AUDIT_ACTIONS.REPORT_EXPORTED,
      entityType: AUDIT_ENTITY_TYPES.REPORT,
      entityId: 'overdue-returns',
      metadata: {
        reportType: 'overdue-returns',
        format: ReportFormat.XLSX,
        filters: {
          asOfDate: '2026-08-10',
          developmentId: undefined,
          investorId: undefined,
        },
      },
    });
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
    expect(auditService.record).toHaveBeenCalledWith({
      organizationId: USER.organizationId,
      actorUserId: USER.id,
      action: AUDIT_ACTIONS.REPORT_EXPORTED,
      entityType: AUDIT_ENTITY_TYPES.REPORT,
      entityId: 'investor-positions',
      metadata: {
        reportType: 'investor-positions',
        format: ReportFormat.XLSX,
        filters: {
          developmentId: undefined,
          investorId: 'investor-a',
        },
      },
    });
  });

  it('does not send a generated report when its audit event cannot be persisted', async () => {
    reportsService.captations.mockResolvedValue(xlsxReport());
    auditService.record.mockRejectedValue(new Error('audit unavailable'));
    const response = responseMock();

    await expect(
      controller.captations(
        USER,
        { format: ReportFormat.XLSX },
        response.value,
      ),
    ).rejects.toThrow('audit unavailable');

    expect(response.send).not.toHaveBeenCalled();
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

function createAuditServiceMock() {
  return {
    record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
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
