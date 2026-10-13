import { Test } from '@nestjs/testing';
import { StoreService } from '../../../src/core/store.service';
import { MarketServiceImpl } from '../../../src/market/implementations/market.service.impl';
import { BtParamItem, FactorLibItem } from '../../../src/types';

/* ==========================================================
   B-INT-03 市场接口实现单元测试
   MarketServiceImpl 是薄委托层：因子库/回测参数来自 StoreService ——
   验证委托与透传，不关心存储细节
   （历史上的选股筛选 ScreenService 已随演示 mock 一起下线）
   ========================================================== */

describe('MarketServiceImpl', () => {
  let service: MarketServiceImpl;
  let store: { getFactorLib: jest.Mock; getBtParams: jest.Mock };

  beforeEach(async () => {
    store = { getFactorLib: jest.fn(), getBtParams: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketServiceImpl,
        { provide: StoreService, useValue: store },
      ],
    }).compile();

    service = moduleRef.get(MarketServiceImpl);
  });

  describe('listFactors（API-14 因子库数据源）', () => {
    it('返回存储层的因子库', () => {
      const lib: FactorLibItem[] = [
        { id: 'value', name: '价值因子', desc: 'EP、BP、股息率' },
        { id: 'momentum', name: '动量因子', desc: '20日/60日相对强弱' },
      ];
      store.getFactorLib.mockReturnValue(lib);

      expect(service.listFactors()).toBe(lib);
      expect(store.getFactorLib).toHaveBeenCalledTimes(1);
    });
  });

  describe('listBtParams（API-15 回测参数配置项数据源）', () => {
    it('返回存储层的回测参数', () => {
      const params: BtParamItem[] = [
        { label: '回测区间', value: '2023-09 ~ 2026-09', hint: '历史模拟回测区间，共 3 年' },
        { label: 'Top K', value: '50 只', hint: '每次调仓选取综合因子得分最高的 K 只股票' },
      ];
      store.getBtParams.mockReturnValue(params);

      expect(service.listBtParams()).toBe(params);
      expect(store.getBtParams).toHaveBeenCalledTimes(1);
    });
  });
});
