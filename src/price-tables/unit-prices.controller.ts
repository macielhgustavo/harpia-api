import { Body, Controller, Delete, Param, Patch } from '@nestjs/common';
import { PriceTablesService } from './price-tables.service';
import { UpdateUnitPriceDto } from './dto/update-unit-price.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.PRICES_READ)
@Controller('unit-prices')
export class UnitPricesController {
  constructor(private readonly priceTablesService: PriceTablesService) {}

  @RequirePermissions(PERMISSIONS.PRICES_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateUnitPriceDto,
  ) {
    return this.priceTablesService.updatePrice(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.PRICES_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.priceTablesService.removePrice(id, user.organizationId);
  }
}
