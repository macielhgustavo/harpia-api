import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateDevelopmentDto } from './update-development.dto';

describe('UpdateDevelopmentDto nullable dates', () => {
  it('accepts null to clear either expected date', async () => {
    const dto = plainToInstance(UpdateDevelopmentDto, {
      expectedLaunchDate: null,
      expectedDeliveryDate: null,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts absence as a no-op and still rejects invalid non-null dates', async () => {
    await expect(
      validate(plainToInstance(UpdateDevelopmentDto, {})),
    ).resolves.toHaveLength(0);

    const errors = await validate(
      plainToInstance(UpdateDevelopmentDto, {
        expectedLaunchDate: 'amanhã',
      }),
    );
    expect(errors.map((error) => error.property)).toEqual([
      'expectedLaunchDate',
    ]);
  });
});
