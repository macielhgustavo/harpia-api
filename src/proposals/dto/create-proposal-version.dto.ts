import { PickType } from '@nestjs/mapped-types';
import { CreateProposalDto } from './create-proposal.dto';

export class CreateProposalVersionDto extends PickType(CreateProposalDto, [
  'discount',
  'validUntil',
  'notes',
  'conditions',
] as const) {}
