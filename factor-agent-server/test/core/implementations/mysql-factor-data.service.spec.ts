import { MysqlFactorDataService } from '../../../src/core/implementations/mysql-factor-data.service';
import { ApiException } from '../../../src/common/api.exception';

/* ==========================================================
   取数白名单检验单元测试（不触库）
   检验发生在 SQL 拼接前：表名必须出自 SQL/tables.md，
   因子字段必须出自 SQL/<表名>.md；全部通过后才进入连接池创建。
   ========================================================== */

/** 合法入参基线：表/日期/证券代码均合法，用例按需覆写 */
const baseQuery = {
  table: 'equ_factor_cf',
  fields: ['CTOP'],
  date: '20210506',
  security: '000002.XSHE',
};

/** ConfigService 替身：getOrThrow 返回未配置 user 的连接信息，
 *  若入参通过全部检验，将走到连接池懒创建并以 DATA_SOURCE_ERROR 终止（证明未触库） */
const makeService = () =>
  new MysqlFactorDataService({
    getOrThrow: () => ({ host: '', port: 0, user: '', password: '', database: '', connectionLimit: 0 }),
  } as never);

const expectApiError = async (run: () => Promise<unknown>, code: string, messagePart: string) => {
  const err = await run().then(
    () => {
      throw new Error('应当抛出 ApiException');
    },
    (e) => e as ApiException,
  );
  expect(err).toBeInstanceOf(ApiException);
  expect(err.code).toBe(code);
  expect(err.message).toContain(messagePart);
};

describe('MysqlFactorDataService 白名单检验', () => {
  it('表不在 SQL/tables.md 清单中 → 拒绝并提示可用表', async () => {
    await expectApiError(
      () => makeService().readTable({ ...baseQuery, table: 'no_such_table' }),
      'INVALID_ARGUMENT',
      '表不在字段字典中',
    );
    await expectApiError(
      () => makeService().readTable({ ...baseQuery, table: 'users' }),
      'INVALID_ARGUMENT',
      'equ_factor_cf, equ_factor_derive',
    );
  });

  it('因子字段不在该表 SQL/<表名>.md 中 → 拒绝', async () => {
    await expectApiError(
      () => makeService().readTable({ ...baseQuery, fields: ['EBIT'] }),
      'INVALID_ARGUMENT',
      '无此因子字段',
    );
  });

  it('字段含非法字符（防注入格式检验） → 拒绝', async () => {
    await expectApiError(
      () => makeService().readTable({ ...baseQuery, fields: ['CTOP; DROP TABLE x'] }),
      'INVALID_ARGUMENT',
      '非法字段名',
    );
  });

  it('日期 / 证券代码格式非法 → 拒绝', async () => {
    await expectApiError(
      () => makeService().readTable({ ...baseQuery, date: '2021-05-06' }),
      'INVALID_ARGUMENT',
      '日期必须',
    );
    await expectApiError(
      () => makeService().readTable({ ...baseQuery, security: '000002' }),
      'INVALID_ARGUMENT',
      '证券代码',
    );
  });

  it('表与因子字段均命中白名单 → 通过检验，因连接未配置而以 DATA_SOURCE_ERROR 终止', async () => {
    await expectApiError(() => makeService().readTable(baseQuery), 'DATA_SOURCE_ERROR', 'MySQL 未配置');
  });
});

/* ----- date 类型列适配（ADR-0010 配套，2026-10-23 NaN 修复）-----
   精品因子库 equ_fancy_factors_table1~10 的 TRADE_DATE 是 date 类型（连接 dateStrings:true
   返回 'YYYY-MM-DD'），与既有 BIGINT yyyymmdd 表口径不同——查询参数与返回值须按列类型分流 */

describe('readTradeDates/readFactorSection/readFactorRange 的 date 类型列适配', () => {
  const DATE_TYPE_TABLE = 'equ_fancy_factors_table2'; // 字典 md 里 TRADE_DATE 类型为 date（真实文件）
  const BIGINT_TABLE = 'equ_factor_obos';

  const makeSvcWithPool = (rowsByMarker: Array<{ match: RegExp; rows: Record<string, unknown>[] }>) => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const fakePool = {
      query: async (sql: string, params: unknown[] = []) => {
        captured.push({ sql, params });
        for (const m of rowsByMarker) if (m.match.test(sql)) return [m.rows];
        return [[]];
      },
      execute: async (sql: string, params: unknown[] = []) => {
        captured.push({ sql, params });
        for (const m of rowsByMarker) if (m.match.test(sql)) return [m.rows];
        return [[]];
      },
    };
    const svc = new MysqlFactorDataService({
      getOrThrow: () => ({ host: '', port: 0, user: '', password: '', database: '', connectionLimit: 0 }),
    } as never);
    (svc as unknown as { pool: unknown }).pool = fakePool;
    return { svc, captured };
  };

  it('date 类型表 readTradeDates：区间参数转 dash、返回值转 yyyymmdd 数字', async () => {
    const { svc, captured } = makeSvcWithPool([
      { match: /MIN\(TRADE_DATE\)/, rows: [{ mn: '2021-05-01', mx: '2026-09-19' }] },
      { match: /DISTINCT TRADE_DATE/, rows: [{ d: '2021-05-01' }, { d: '2021-05-03' }] },
    ]);
    const cov = await svc.readTradeDates(DATE_TYPE_TABLE, '20250101', '20251231');
    expect(cov.min).toBe(20210501);
    expect(cov.max).toBe(20260919);
    expect(cov.dates).toEqual([20210501, 20210503]);
    const between = captured.find((c) => c.sql.includes('BETWEEN'));
    expect(between!.params).toEqual(['2025-01-01', '2025-12-31']);
  });

  it('BIGINT 表 readTradeDates：裸数字口径不变', async () => {
    const { svc, captured } = makeSvcWithPool([
      { match: /MIN\(TRADE_DATE\)/, rows: [{ mn: 20210506, mx: 20260918 }] },
      { match: /DISTINCT TRADE_DATE/, rows: [{ d: 20210506 }, { d: 20210508 }] },
    ]);
    const cov = await svc.readTradeDates(BIGINT_TABLE, '20250101', '20251231');
    expect(cov.min).toBe(20210506);
    expect(cov.max).toBe(20260918);
    expect(cov.dates).toEqual([20210506, 20210508]);
    const between = captured.find((c) => c.sql.includes('BETWEEN'));
    expect(between!.params).toEqual([20250101, 20251231]);
  });

  it('date 类型表 readFactorSection：日期参数转 dash', async () => {
    const { svc, captured } = makeSvcWithPool([
      { match: /ROE_TTM/, rows: [{ SECURITY_ID: '000001.XSHE', v: '0.08' }] },
    ]);
    const rows = await svc.readFactorSection(DATE_TYPE_TABLE, 'ROE_TTM', '20250102', null);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(0.08);
    const sectionCall = captured.find((c) => c.sql.includes('TRADE_DATE = ?'));
    expect(sectionCall!.params[0]).toBe('2025-01-02');
  });

  it('date 类型表 readFactorRange：BETWEEN 参数转 dash、返回 tradeDate 保真', async () => {
    const { svc, captured } = makeSvcWithPool([
      { match: /TRADE_DATE BETWEEN/, rows: [{ SECURITY_ID: '000001.XSHE', TRADE_DATE: '2025-01-02', v: '0.1' }] },
    ]);
    const rows = await svc.readFactorRange(DATE_TYPE_TABLE, 'ROE_TTM', ['000001.XSHE'], '20250101', '20250131');
    expect(rows).toHaveLength(1);
    expect(rows[0].tradeDate).toBe('2025-01-02');
    const rangeCall = captured.find((c) => c.sql.includes('BETWEEN'));
    expect(rangeCall!.params.slice(0, 2)).toEqual(['2025-01-01', '2025-01-31']);
  });
});
