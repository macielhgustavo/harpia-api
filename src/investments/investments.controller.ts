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
import { InvestmentsService } from './investments.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { UpdateInvestmentDto } from './dto/update-investment.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.INVESTMENTS_READ)
@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('investorId') investorId?: string,
  ) {
    return this.investmentsService.findAll(user.organizationId, investorId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.investmentsService.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.INVESTMENTS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvestmentDto) {
    return this.investmentsService.create(
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }

  @RequirePermissions(PERMISSIONS.INVESTMENTS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateInvestmentDto,
  ) {
    return this.investmentsService.update(
      id,
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }

  @RequirePermissions(PERMISSIONS.INVESTMENTS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.investmentsService.remove(id, {
      id: user.id,
      organizationId: user.organizationId,
    });
  }
}
