import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** 可配置的设置项白名单：模型与数据来源为 readonly 展示项，不接受用户调整 */
export class UpdateSettingDto {
  @IsString()
  @IsIn(['notify', 'report', 'risk'], { message: '未知的设置项 key' })
  key: string;

  /** toggle 型设置项传 on */
  @IsOptional()
  @IsBoolean()
  on?: boolean;

  /** single 型（风险偏好）传 value */
  @IsOptional()
  @IsString()
  value?: string;
}
