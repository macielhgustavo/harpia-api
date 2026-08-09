import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUnitTypeDto } from './create-unit-type.dto';
import { UpdateUnitTypeDto } from './update-unit-type.dto';

describe('UnitType DTOs', () => {
  it('trims a valid name on create', async () => {
    const dto = plainToInstance(CreateUnitTypeDto, {
      developmentId: 'development-1',
      name: '  Apartamento  ',
      standardArea: 0,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.name).toBe('Apartamento');
  });

  it.each([null, '', '   ', 'a'.repeat(121)])(
    'rejects invalid create name %p',
    async (name) => {
      const dto = plainToInstance(CreateUnitTypeDto, {
        developmentId: 'development-1',
        name,
      });

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );

  it('rejects negative area and null numeric values on create', async () => {
    const negativeArea = plainToInstance(CreateUnitTypeDto, {
      developmentId: 'development-1',
      name: 'Apartamento',
      standardArea: -0.01,
    });
    const nullBedrooms = plainToInstance(CreateUnitTypeDto, {
      developmentId: 'development-1',
      name: 'Apartamento',
      bedrooms: null,
    });

    await expect(validate(negativeArea)).resolves.not.toHaveLength(0);
    await expect(validate(nullBedrooms)).resolves.not.toHaveLength(0);
  });

  it('allows omission and null only for numeric fields on update', async () => {
    await expect(
      validate(plainToInstance(UpdateUnitTypeDto, {})),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(UpdateUnitTypeDto, {
          bedrooms: null,
          suites: null,
          standardArea: null,
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it.each([null, '', '   ', 'a'.repeat(121)])(
    'rejects invalid update name %p',
    async (name) => {
      const dto = plainToInstance(UpdateUnitTypeDto, { name });

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );

  it('trims an updated name and rejects negative numeric values', async () => {
    const valid = plainToInstance(UpdateUnitTypeDto, {
      name: '  Cobertura  ',
    });
    const negative = plainToInstance(UpdateUnitTypeDto, {
      bedrooms: -1,
      standardArea: -1,
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.name).toBe('Cobertura');
    await expect(validate(negative)).resolves.not.toHaveLength(0);
  });
});
