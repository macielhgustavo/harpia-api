import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Board filters mirror the opportunity listing exactly, minus `stageId`: the
 * board always returns every stage of the pipeline, each with its own page.
 */
export class BoardQueryDto {
  @IsOptional()
  @IsString()
  pipelineId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  developmentId?: string;

  @IsOptional()
  @IsString()
  personId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  search?: string;

  /**
   * Opportunities returned per stage. `0` asks for summaries only, which is how
   * the board refreshes its totals after a card moves without reloading lists.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  stageLimit?: number = 20;
}
