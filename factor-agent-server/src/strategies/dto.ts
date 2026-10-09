import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
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

/* ----- API-27：由回测卡片创建策略（等权回测配置，服务端按它重跑真引擎） ----- */

export class BacktestFactorDto {
  @IsString()
  @IsNotEmpty({ message: '因子 table 不能为空' })
  table: string;

  @IsString()
  @IsNotEmpty({ message: '因子 field 不能为空' })
  field: string;

  @IsIn(['desc', 'asc'], { message: 'order 只能是 desc（值大优）/ asc（值小优）' })
  order: 'desc' | 'asc';
}

export class BacktestRunConfigDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'factors 至少包含一个因子' })
  @ArrayMaxSize(10, { message: 'factors 最多 10 个' })
  @ValidateNested({ each: true })
  @Type(() => BacktestFactorDto)
  factors: BacktestFactorDto[];

  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 须为 YYYYMMDD 8 位数字' })
  startDate: string;

  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 须为 YYYYMMDD 8 位数字' })
  endDate: string;

  @IsIn(['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom'], {
    message: 'frequency 取值非法',
  })
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom';

  @IsOptional()
  @IsInt()
  @Min(5, { message: 'everyNTd 最小 5' })
  @Max(120, { message: 'everyNTd 最大 120' })
  everyNTd?: number;

  @IsInt()
  @Min(1, { message: 'topK 最小 1' })
  @Max(200, { message: 'topK 最大 200' })
  topK: number;

  @IsIn(['hs300', 'csi500', 'sse'], { message: 'benchmark 只能是 hs300 / csi500 / sse' })
  benchmark: 'hs300' | 'csi500' | 'sse';

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'feeRate 不能为负' })
  @Max(0.05, { message: 'feeRate 最大 0.05（每边 5%）' })
  feeRate?: number;
}

export class CreateFromBacktestDto {
  @IsString()
  @IsNotEmpty({ message: 'name 不能为空' })
  @MaxLength(80, { message: 'name 不能超过 80 字' })
  name: string;

  @ValidateNested()
  @Type(() => BacktestRunConfigDto)
  config: BacktestRunConfigDto;
}
