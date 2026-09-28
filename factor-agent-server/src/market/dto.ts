import { ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ScreenFilterDto {
  /** 筛选字段：roe_ttm / pe_percentile / dividend_yield / volatility / momentum_20d */
  @IsString()
  @IsIn(['roe_ttm', 'pe_percentile', 'dividend_yield', 'volatility', 'momentum_20d'], {
    message: '不支持的筛选字段',
  })
  field: string;

  @IsIn(['>', '<', '>=', '<=', '=='], { message: '不支持的比较符' })
  op: string;

  @IsNumber()
  value: number;
}

export class ScreenDto {
  @IsOptional()
  @IsString()
  universe?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'filters 至少包含一个筛选条件' })
  @ValidateNested({ each: true })
  filters: ScreenFilterDto[];

  /** 返回前 N 只，默认 5 */
  @IsOptional()
  @IsInt()
  @Min(1)
  topN?: number;
}
