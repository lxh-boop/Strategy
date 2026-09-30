import { Body, Controller, Post } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from './public.decorator';
import { appendClientLog } from './client-log';

/** 前端上报的日志条目：level 白名单，message 必填，detail/page 可选 */
class ClientLogDto {
  @IsIn(['error', 'warn', 'info'])
  level: 'error' | 'warn' | 'info';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsObject()
  detail?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  page?: string;
}

/* ==========================================================
   前端日志上报（公开接口：登录前的报错也要能收）。
   只做最小校验 + 追加落盘，无查询/无存储膨胀设计——
   文件按天滚动，前端侧有限流，见 factor-agent-react/src/api.ts reportClientLog。
   ========================================================== */
@Controller('api/client-logs')
export class ClientLogsController {
  @Public()
  @Post()
  append(@Body() dto: ClientLogDto): { ok: true } {
    appendClientLog(dto);
    return { ok: true };
  }
}
