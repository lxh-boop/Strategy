import { MysqlFactorDataService } from '../../../src/core/implementations/mysql-factor-data.service';

/* ==========================================================
   取数缓存行为单元测试：mock 掉 mysql2 连接池，不触真库
   验证：同 SQL+参数重复读取只执行一次；参数不同不误命中；并发同查询去重
   ========================================================== */

jest.mock('mysql2/promise', () => {
  const execute = jest.fn().mockResolvedValue([[{ SECURITY_ID: '000002.XSHE', TRADE_DATE: '2021-05-06', CTOP: '1.23' }]]);
  return { createPool: jest.fn(() => ({ execute })), __mockExecute: execute };
});

/* 从 mock 里取出 execute 句柄，统计真实打库次数 */
const getExecute = (): jest.Mock =>
  (jest.requireMock('mysql2/promise') as { __mockExecute: jest.Mock }).__mockExecute;

/** 已配置连接信息的 ConfigService 替身：池可创建，execute 走上面的 mock */
const makeService = () =>
  new MysqlFactorDataService({
    getOrThrow: () => ({ host: 'mock', port: 3306, user: 'u', password: 'p', database: 'd', connectionLimit: 1 }),
  } as never);

const baseQuery = { table: 'equ_factor_cf', fields: ['CTOP'], date: '20210506', security: '000002.XSHE' };

describe('MysqlFactorDataService 取数缓存', () => {
  beforeEach(() => {
    getExecute().mockClear();
  });

  it('同 SQL+参数重复读取 → 第二次走缓存，打库仅 1 次，数据一致', async () => {
    const svc = makeService();
    const first = await svc.readTable({ ...baseQuery });
    const second = await svc.readTable({ ...baseQuery });
    expect(getExecute()).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('参数不同（日期不同）→ 不误命中，各打一次库', async () => {
    const svc = makeService();
    await svc.readTable({ ...baseQuery });
    await svc.readTable({ ...baseQuery, date: '20210507' });
    expect(getExecute()).toHaveBeenCalledTimes(2);
  });

  it('并发同查询 → 去重为一次打库，两调用拿到同一结果', async () => {
    const svc = makeService();
    const [a, b] = await Promise.all([
      svc.readTable({ ...baseQuery }),
      svc.readTable({ ...baseQuery }),
    ]);
    expect(getExecute()).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });
});
