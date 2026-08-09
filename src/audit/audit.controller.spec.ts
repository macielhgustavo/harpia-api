import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/permissions/require-permissions.decorator';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

describe('AuditController', () => {
  let auditService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
  };
  let controller: AuditController;

  beforeEach(() => {
    auditService = { findAll: jest.fn(), findOne: jest.fn() };
    controller = new AuditController(auditService as unknown as AuditService);
  });

  it('requires AUDIT_READ and exposes no mutation methods', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AuditController),
    ).toEqual([PERMISSIONS.AUDIT_READ]);
    expect(
      Object.getOwnPropertyNames(AuditController.prototype).sort(),
    ).toEqual(['constructor', 'findAll', 'findOne']);
  });

  it('always delegates list and detail reads with the authenticated tenant', async () => {
    const user = { organizationId: 'org-a' };
    const query = { action: 'UPDATE', page: 2 };
    auditService.findAll.mockResolvedValue({ data: [], pagination: {} });
    auditService.findOne.mockResolvedValue({ id: 'audit-1' });

    await controller.findAll(user, query);
    await controller.findOne('audit-1', user);

    expect(auditService.findAll).toHaveBeenCalledWith('org-a', query);
    expect(auditService.findOne).toHaveBeenCalledWith('audit-1', 'org-a');
  });

  it('validates ISO dates and caps pageSize at 100', async () => {
    const invalid = plainToInstance(ListAuditLogsQueryDto, {
      startDate: 'not-a-date',
      page: '0',
      pageSize: '101',
    });
    const valid = plainToInstance(ListAuditLogsQueryDto, {
      startDate: '2026-08-01T00:00:00.000Z',
      page: '1',
      pageSize: '100',
    });

    await expect(validate(invalid)).resolves.toHaveLength(3);
    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.pageSize).toBe(100);
  });
});
