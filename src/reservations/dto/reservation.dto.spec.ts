import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelReservationDto } from './cancel-reservation.dto';
import { CreateReservationDto } from './create-reservation.dto';
import { ListReservationsQueryDto } from './list-reservations-query.dto';

describe('reservation DTOs', () => {
  it('accepts a valid create payload and rejects malformed expiration', async () => {
    const valid = plainToInstance(CreateReservationDto, {
      unitId: 'unit-1',
      personId: 'person-1',
      expiresAt: '2026-08-20T12:00:00.000Z',
    });
    expect(await validate(valid)).toHaveLength(0);

    const invalid = plainToInstance(CreateReservationDto, {
      unitId: 'unit-1',
      personId: 'person-1',
      expiresAt: 'amanhã',
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('trims and requires a cancellation reason', async () => {
    const dto = plainToInstance(CancelReservationDto, { reason: '   ' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('transforms pagination and validates status filters', async () => {
    const dto = plainToInstance(ListReservationsQueryDto, {
      page: '2',
      pageSize: '50',
      status: 'ATIVA',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(50);
  });
});
