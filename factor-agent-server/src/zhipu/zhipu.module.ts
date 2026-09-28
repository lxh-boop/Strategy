import { Module } from '@nestjs/common';
import { ZhipuService } from './zhipu.service';

@Module({
  providers: [ZhipuService],
  exports: [ZhipuService],
})
export class ZhipuModule {}
