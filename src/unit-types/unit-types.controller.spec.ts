import { UnitTypesController } from './unit-types.controller';
import { UnitTypesService } from './unit-types.service';

describe('UnitTypesController mutation actor contract', () => {
  it('forwards the authenticated actor instead of accepting tenant data from DTOs', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'type-1' }),
      update: jest.fn().mockResolvedValue({ id: 'type-1' }),
      remove: jest.fn().mockResolvedValue({ id: 'type-1' }),
    };
    const controller = new UnitTypesController(
      service as unknown as UnitTypesService,
    );
    const user = {
      id: 'user-1',
      email: 'operacional@harpia.test',
      organizationId: 'org-a',
    };
    const actor = { id: 'user-1', organizationId: 'org-a' };

    await controller.create(user, {
      developmentId: 'development-1',
      name: 'Dois quartos',
    });
    await controller.update('type-1', user, { bedrooms: 2 });
    await controller.remove('type-1', user);

    expect(service.create).toHaveBeenCalledWith(actor, {
      developmentId: 'development-1',
      name: 'Dois quartos',
    });
    expect(service.update).toHaveBeenCalledWith('type-1', actor, {
      bedrooms: 2,
    });
    expect(service.remove).toHaveBeenCalledWith('type-1', actor);
  });
});
