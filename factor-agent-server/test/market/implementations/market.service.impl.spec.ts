import { Test } from '@nestjs/testing';
import { StoreService } from '../../../src/core/store.service';
import { ScreenService } from '../../../src/core/screen.service';
import { MarketServiceImpl } from '../../../src/market/implementations/market.service.impl';
import { ScreenDto } from '../../../src/market/dto';
import { BtParamItem, FactorLibItem, ScreenResult } from '../../../src/types';

/* ==========================================================
   B-INT-03 市场接口实现单元测试
   MarketServiceImpl 是薄委托层：因子库/回测参数来自 StoreService，
   筛选来自 ScreenService —— 验证委托与透传，不关心存储与筛选细节
   ========================================================== */

describe('MarketServiceImpl', () => {
  let service: MarketServiceImpl;
  let store: { getFactorLib: jest.Mock; getBtParams: jest.Mock };
  let screenService: { screen: jest.Mock };

  beforeEach(async () => {
    store = { getFactorLib: jest.fn(), getBtParams: jest.fn() };
    screenService = { screen: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketServiceImpl,
        { provide: StoreService, useValue: store },
        { provide: ScreenService, useValue: screenService },
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

  describe('screen（API-16 选股筛选数据源）', () => {
    it('把筛选条件透传给筛选引擎并返回结果', () => {
      const dto: ScreenDto = {
        universe: 'hs300',
        filters: [{ field: 'roe_ttm', op: '>', value: 12 }],
        topN: 5,
      };
      const result: ScreenResult = {
        stocks: [{ code: '600519.SH', name: '贵州茅台', score: 92.5, weight: null }],
        total: 1,
      };
      screenService.screen.mockReturnValue(result);

      expect(service.screen(dto)).toBe(result);
      expect(screenService.screen).toHaveBeenCalledTimes(1);
      expect(screenService.screen).toHaveBeenCalledWith(dto);
    });

    it('可选字段缺省时同样原样透传', () => {
      const dto: ScreenDto = {
        filters: [{ field: 'pe_percentile', op: '<', value: 30 }],
      };

      service.screen(dto);

      expect(screenService.screen).toHaveBeenCalledWith(dto);
    });
  });
});
