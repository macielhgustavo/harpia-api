import { PartialType } from '@nestjs/mapped-types';
import { CreateMonetaryIndexValueDto } from './create-monetary-index-value.dto';

export class UpdateMonetaryIndexValueDto extends PartialType(CreateMonetaryIndexValueDto) {}
