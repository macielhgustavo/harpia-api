import { PartialType } from '@nestjs/mapped-types';
import { CreateReceivableAdjustmentPolicyDto } from './create-receivable-adjustment-policy.dto';

export class UpdateReceivableAdjustmentPolicyDto extends PartialType(CreateReceivableAdjustmentPolicyDto) {}
