import { Controller, Get } from '@nestjs/common';
import { Public } from './common/public.decorator';
import { ZhipuService } from './zhipu/zhipu.service';

@Controller('api')
export class AppController {
  constructor(private readonly zhipu: ZhipuService) {}

  /** API-01 健康检查（公开） */
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'factor-agent-server',
      zhipuConfigured: this.zhipu.configured,
      defaultModel: this.zhipu.defaultModel,
    };
  }
}
