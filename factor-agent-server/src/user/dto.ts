import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @IsIn(['notify', 'report', 'apikey', 'datasrc', 'risk'], { message: '未知的设置项 key' })
  key: string;

  /** toggle 型设置项传 on，其余类型不适用 */
  @IsOptional()
  @IsBoolean()
  on?: boolean;

  /** single 型（风险偏好）传 value */
  @IsOptional()
  @IsString()
  value?: string;

  /** multi 型（数据源）传 values，存储为 " + " 拼接的展示值 */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  values?: string[];
}

export class CreateApiKeyDto {
  @IsString()
  @Length(1, 40, { message: '密钥名称长度需在 1~40 字符之间' })
  name: string;

  @IsString()
  @Length(1, 200, { message: '密钥内容长度需在 1~200 字符之间' })
  key: string;
}
