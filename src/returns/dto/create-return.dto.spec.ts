import { ReturnStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReturnDto } from './create-return.dto';

describe('CreateReturnDto', () => {
  it('accepts persisted statuses and rejects computed ATRASADO', async () => {
    const validDto = plainToInstance(CreateReturnDto, {
      allocationId: 'allocation-1',
      expectedAmount: 1500,
      expectedDate: '2026-08-15',
      status: ReturnStatus.PENDENTE,
    });
    const invalidDto = plainToInstance(CreateReturnDto, {
      allocationId: 'allocation-1',
      expectedAmount: 1500,
      expectedDate: '2026-08-15',
      status: ReturnStatus.ATRASADO,
    });

    await expect(validate(validDto)).resolves.toHaveLength(0);
    await expect(validate(invalidDto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'status' })]),
    );
  });
});
