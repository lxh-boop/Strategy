import { MarketServiceImpl } from '../../../src/market/implementations/market.service.impl';
import { BT_PARAMS } from '../../../src/market/market.service';

/* ==========================================================
   B-INT-03 市场数据实现单元测试：配置型数据直读常量
   （历史数据源 StoreService/内存演示存储已随演示链清理下线）
   ========================================================== */

describe('B-INT-03 MarketServiceImpl（市场数据）', () => {
  const svc = new MarketServiceImpl();

  it('listBtParams：返回回测参数展示项（含区间/TopK/费率三项）', () => {
    const items = svc.listBtParams();
    expect(items).toEqual(BT_PARAMS);
    expect(items.map((i) => i.label)).toEqual(['回测区间', 'Top K', '手续费率']);
    for (const i of items) {
      expect(i.label).toBeTruthy();
      expect(i.value).toBeTruthy();
      expect(i.hint).toBeTruthy();
    }
  });
});
