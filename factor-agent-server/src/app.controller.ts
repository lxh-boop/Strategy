import { Controller, Get } from '@nestjs/common';
import { ZhipuService } from './zhipu/zhipu.service';

@Controller('api')
export class AppController {
  constructor(private readonly zhipu: ZhipuService) {}

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
