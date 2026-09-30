import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
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
  /* 长度上限与 user-tables.sql 列宽一致，超长在 DTO 层返回 400 而非数据库 500 */
  @IsString()
  @IsNotEmpty({ message: 'name 不能为空' })
  @MaxLength(80, { message: 'name 不能超过 80 字' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'universe 不能超过 40 字' })
  universe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'rebalance 不能超过 20 字' })
  rebalance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'benchmark 不能超过 40 字' })
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
  @MaxLength(80, { message: 'name 不能超过 80 字' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'universe 不能超过 40 字' })
  universe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'rebalance 不能超过 20 字' })
  rebalance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'benchmark 不能超过 40 字' })
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
