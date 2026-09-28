import { Module } from '@nestjs/common';
import { ZhipuService } from './zhipu.service';
import { HttpZhipuService } from './implementations/http-zhipu.service';

/** 智谱直连客户端：接口 token → 实现（OpenAI 兼容 HTTP 客户端） */
@Module({
  providers: [{ provide: ZhipuService, useClass: HttpZhipuService }],
  exports: [ZhipuService],
})
export class ZhipuModule {}
