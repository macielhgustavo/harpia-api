import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PriceTablesService } from './price-tables.service';
import { CreatePriceTableDto } from './dto/create-price-table.dto';
import { UpdatePriceTableDto } from './dto/update-price-table.dto';
import { SetUnitPriceDto } from './dto/set-unit-price.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.PRICES_READ)
@Controller('price-tables')
export class PriceTablesController {
  constructor(private readonly priceTablesService: PriceTablesService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('developmentId') developmentId: string,
  ) {
    return this.priceTablesService.findAll(user.organizationId, developmentId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.priceTablesService.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.PRICES_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePriceTableDto) {
    return this.priceTablesService.create(
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }

  @RequirePermissions(PERMISSIONS.PRICES_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePriceTableDto,
  ) {
    return this.priceTablesService.update(
      id,
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }

  @RequirePermissions(PERMISSIONS.PRICES_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.priceTablesService.remove(id, {
      id: user.id,
      organizationId: user.organizationId,
    });
  }

  // Define/atualiza o preço de uma unidade nesta tabela (upsert).
  @RequirePermissions(PERMISSIONS.PRICES_WRITE)
  @Post(':id/prices')
  setPrice(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SetUnitPriceDto,
  ) {
    return this.priceTablesService.setPrice(
      id,
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }
}
