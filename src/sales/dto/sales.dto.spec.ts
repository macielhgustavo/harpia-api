import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConvertProposalToSaleDto } from './convert-proposal-to-sale.dto';
import { CreateSaleCommissionDto } from './create-sale-commission.dto';
import { ListSalesQueryDto } from './list-sales-query.dto';

describe('Sales DTOs', () => {
  it('accepts a normalized conversion with multiple buyers and commission', async () => {
    const dto = plainToInstance(ConvertProposalToSaleDto, {
      saleNumber: ' VEN-2026-0001 ',
      saleDate: '2026-08-25',
      buyers: [
        {
          personId: 'person-1',
          participationPercentage: '60.00',
          isPrimary: true,
        },
        {
          personId: 'person-2',
          participationPercentage: '40.00',
          isPrimary: false,
        },
      ],
      commissions: [{ userId: 'user-2', amount: '5000.00' }],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.saleNumber).toBe('VEN-2026-0001');
  });

  it('rejects malformed monetary values and buyer percentages', async () => {
    const dto = plainToInstance(ConvertProposalToSaleDto, {
      buyers: [
        {
          personId: 'person-1',
          participationPercentage: '100.001',
          isPrimary: true,
        },
      ],
      commissions: [{ personId: 'person-2', amount: '-1' }],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('keeps date filters calendar-only', async () => {
    const valid = plainToInstance(ListSalesQueryDto, {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      page: '2',
      pageSize: '50',
    });
    const timestamp = plainToInstance(ListSalesQueryDto, {
      startDate: '2026-08-01T12:00:00.000Z',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.page).toBe(2);
    expect(await validate(timestamp)).not.toHaveLength(0);
  });

  it('accepts exactly one commission beneficiary at DTO level for service validation', async () => {
    const dto = plainToInstance(CreateSaleCommissionDto, {
      personId: 'person-1',
      amount: '1000.00',
      percentage: '1.25',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
