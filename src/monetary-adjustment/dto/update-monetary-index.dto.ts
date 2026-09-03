import { PartialType } from '@nestjs/mapped-types';
import { CreateMonetaryIndexDto } from './create-monetary-index.dto';

export class UpdateMonetaryIndexDto extends PartialType(CreateMonetaryIndexDto) {}
