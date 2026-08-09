import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListAuditLogsQueryDto } from './list-audit-logs-query.dto';

describe('ListAuditLogsQueryDto date filters', () => {
  it('accepts date-only and full ISO timestamp boundaries', async () => {
    const dateOnly = plainToInstance(ListAuditLogsQueryDto, {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
    const timestamps = plainToInstance(ListAuditLogsQueryDto, {
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.999Z',
    });

    await expect(validate(dateOnly)).resolves.toHaveLength(0);
    await expect(validate(timestamps)).resolves.toHaveLength(0);
  });

  it('rejects non-ISO date boundaries', async () => {
    const dto = plainToInstance(ListAuditLogsQueryDto, {
      startDate: '01/08/2026',
      endDate: 'fim-do-mes',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'endDate',
      'startDate',
    ]);
  });
});
