import { validate } from 'class-validator';
import { CaptationsReportQueryDto } from './captations-report-query.dto';
import { ReportFormat } from './report-format-query.dto';
import { ReturnsReportQueryDto } from './returns-report-query.dto';

describe('report query DTOs', () => {
  it('requires one of the supported report formats', async () => {
    const missingFormat = new CaptationsReportQueryDto();
    const invalidFormat = Object.assign(new CaptationsReportQueryDto(), {
      format: 'csv',
    });

    expect(await validate(missingFormat)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'format' })]),
    );
    expect(await validate(invalidFormat)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'format' })]),
    );
  });

  it('rejects invalid status and non-calendar date formats', async () => {
    const query = Object.assign(new ReturnsReportQueryDto(), {
      format: ReportFormat.XLSX,
      status: 'CANCELADO',
      startDate: '2026/08/02',
      endDate: '2026-08-03',
    });

    const errors = await validate(query);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['status', 'startDate']),
    );
  });

  it('drops organizationId supplied by a client when ValidationPipe whitelists input', async () => {
    const query = Object.assign(new CaptationsReportQueryDto(), {
      format: ReportFormat.PDF,
      organizationId: 'organization-from-client',
    });

    expect(await validate(query, { whitelist: true })).toHaveLength(0);
    expect(query).not.toHaveProperty('organizationId');
  });
});
