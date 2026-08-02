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
import { AllocationsService } from './allocations.service';
import { CreateAllocationDto } from './dto/create-allocation.dto';
import { UpdateAllocationDto } from './dto/update-allocation.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.INVESTMENTS_READ)
@Controller('allocations')
export class AllocationsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('investmentId') investmentId?: string,
    @Query('developmentId') developmentId?: string,
  ) {
    return this.allocationsService.findAll(
      user.organizationId,
      investmentId,
      developmentId,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.allocationsService.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.INVESTMENTS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAllocationDto) {
    return this.allocationsService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.INVESTMENTS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAllocationDto,
  ) {
    return this.allocationsService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.INVESTMENTS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.allocationsService.remove(id, user.organizationId);
  }
}
