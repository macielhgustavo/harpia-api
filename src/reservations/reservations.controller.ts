import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CancelReservationDto } from './dto/cancel-reservation.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ListReservationsQueryDto } from './dto/list-reservations-query.dto';
import { ReservationsService } from './reservations.service';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.SALES_READ)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: ListReservationsQueryDto,
  ) {
    return this.reservations.findAll(user.organizationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reservations.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservations.create(user, dto);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CancelReservationDto,
  ) {
    return this.reservations.cancel(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post(':id/convert')
  convert(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reservations.convert(id, user);
  }
}
