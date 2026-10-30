import { MemoryUserStoreService } from '../../../src/core/implementations/memory-user-store.service';

/* ==========================================================
   Memory 用户存储桩：因子使用统计（ADR-0013 批次，简单计数语义）
   ========================================================== */

describe('MemoryUserStoreService（因子使用统计）', () => {
  it('increment：重复追加计数累加；不同因子各自计数', async () => {
    const store = new MemoryUserStoreService();
    await store.incrementFactorUsage(1, [{ table: 'equ_factor_obos', field: 'REVS20' }]);
    await store.incrementFactorUsage(1, [{ table: 'equ_factor_obos', field: 'REVS20' }]);
    await store.incrementFactorUsage(1, [{ table: 'equ_factor_derive', field: 'NetProfitTTM' }]);
    const usage = await store.listFactorUsage(1);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ factorKey: 'equ_factor_obos.REVS20', count: 2 });
    expect(usage[1].count).toBe(1);
  });

  it('按用户隔离：同因子不同用户互不影响', async () => {
    const store = new MemoryUserStoreService();
    await store.incrementFactorUsage(1, [{ table: 't', field: 'f' }]);
    const other = await store.listFactorUsage(2);
    expect(other).toEqual([]);
  });

  it('limit 截断（按计数降序）', async () => {
    const store = new MemoryUserStoreService();
    for (const f of ['a', 'b', 'c']) await store.incrementFactorUsage(3, [{ table: 't', field: f }]);
    await store.incrementFactorUsage(3, [{ table: 't', field: 'b' }]);
    const usage = await store.listFactorUsage(3, 2);
    expect(usage.map((u) => u.factorKey)).toEqual(['t.b', 't.a']);
  });
});
