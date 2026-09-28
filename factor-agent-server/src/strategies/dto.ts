import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { FactorWeight } from '../types';

export class FactorWeightDto {
  @IsString()
  @IsNotEmpty({ message: '因子 name 不能为空' })
  name: string;

  @IsNumber()
  @Min(0, { message: '因子 weight 不能为负数' })
  weight: number;
}

export class CreateStrategyDto {
  @IsString()
  @IsNotEmpty({ message: 'name 不能为空' })
  name: string;

  @IsOptional()
  @IsString()
  universe?: string;

  @IsOptional()
  @IsString()
  rebalance?: string;

  @IsOptional()
  @IsString()
  benchmark?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'factors 至少包含一个因子' })
  @ValidateNested({ each: true })
  @Type(() => FactorWeightDto)
  factors: FactorWeightDto[];
}

export class UpdateStrategyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  universe?: string;

  @IsOptional()
  @IsString()
  rebalance?: string;

  @IsOptional()
  @IsString()
  benchmark?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'factors 至少包含一个因子' })
  @ValidateNested({ each: true })
  @Type(() => FactorWeightDto)
  factors?: FactorWeightDto[];
}

export class BacktestParamsDto {
  /** 回测区间，如 { "start": "2023-09", "end": "2026-09" } */
  @IsOptional()
  @IsObject()
  period?: { start: string; end: string };

  /** 每次调仓持股数量 */
  @IsOptional()
  @IsInt()
  @Min(1)
  topK?: number;

  /** 双边手续费率，如 0.001 表示 0.1% */
  @IsOptional()
  @IsNumber()
  @Min(0)
  feeRate?: number;
}
