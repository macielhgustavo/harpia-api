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
import { ReturnStatus } from '@prisma/client';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { UpdateReturnDto } from './dto/update-return.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.RETURNS_READ)
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('allocationId') allocationId?: string,
    @Query('investmentId') investmentId?: string,
    @Query('developmentId') developmentId?: string,
    @Query('status') status?: ReturnStatus,
  ) {
    return this.returnsService.findAll(user.organizationId, {
      allocationId,
      investmentId,
      developmentId,
      status,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.returnsService.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.RETURNS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReturnDto) {
    return this.returnsService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.RETURNS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateReturnDto,
  ) {
    return this.returnsService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.RETURNS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.returnsService.remove(id, user.organizationId);
  }
}
