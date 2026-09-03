import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CollectionsService } from './collections.service';
import { CreateCollectionRuleDto } from './dto/create-collection-rule.dto';
import { ListCollectionDispatchesQueryDto } from './dto/list-collection-dispatches-query.dto';
import { UpdateCollectionRuleDto } from './dto/update-collection-rule.dto';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.FINANCE_READ)
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('rules')
  rules(@CurrentUser() user: AuthUser) {
    return this.collections.listRules(user.organizationId);
  }

  @Get('dispatches')
  dispatches(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCollectionDispatchesQueryDto,
  ) {
    return this.collections.listDispatches(user.organizationId, query);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post('rules')
  createRule(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCollectionRuleDto,
  ) {
    return this.collections.createRule(user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Patch('rules/:id')
  updateRule(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCollectionRuleDto,
  ) {
    return this.collections.updateRule(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post('run')
  run(@CurrentUser() user: AuthUser) {
    return this.collections.run(user.organizationId, user.id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post('dispatches/:id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.collections.retry(id, user);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post('dispatches/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.collections.cancel(id, user);
  }
}
