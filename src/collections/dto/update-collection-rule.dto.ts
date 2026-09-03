import { PartialType } from '@nestjs/mapped-types';
import { CreateCollectionRuleDto } from './create-collection-rule.dto';

export class UpdateCollectionRuleDto extends PartialType(
  CreateCollectionRuleDto,
) {}
