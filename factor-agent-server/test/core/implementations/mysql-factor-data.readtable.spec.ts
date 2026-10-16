import { MysqlFactorDataService } from '../../../src/core/implementations/mysql-factor-data.service';

/* ==========================================================
   readTable（read_factor_data）SQL 形状单元测试：mock 掉连接池，
   断言生成的 SQL/参数完全由字段字典推导——
   股票因子表（字符串形 SECURITY_ID + bigint 交易日）、
   指数表（TICKER_SYMBOL + EXCHANGE_CD + date 交易日）、
   证券主表（bigint SECURITY_ID 退到交易代码、静态无交易日）、
   ID 键表（无证券/日期列 → 只 LIMIT 截断）。
   回归锚点：read_factor_data 读 mkt_idxd 曾因写死 SECURITY_ID 报
   Unknown column 而三连失败（2026-10-15 15:34 日志）。
   ========================================================== */

jest.mock('mysql2/promise', () => {
  const execute = jest.fn().mockResolvedValue([[]]);
  return { createPool: jest.fn(() => ({ execute })), __mockExecute: execute };
});

const getExecute = (): jest.Mock =>
  (jest.requireMock('mysql2/promise') as { __mockExecute: jest.Mock }).__mockExecute;

const makeService = () =>
  new MysqlFactorDataService({
    getOrThrow: () => ({ host: 'mock', port: 3306, user: 'u', password: 'p', database: 'd', connectionLimit: 1 }),
  } as never);

describe('readTable SQL 形状（字典推导，不写死列）', () => {
  beforeEach(() => {
    getExecute().mockClear();
  });

  it('股票因子表：字符串形 SECURITY_ID 全码等值 + bigint 交易日按数字', async () => {
    await makeService().readTable({ table: 'equ_factor_cf', fields: ['CTOP'], date: '20210506', security: '000002.XSHE' });
    expect(getExecute()).toHaveBeenCalledWith(
      'SELECT `TRADE_DATE`, `SECURITY_ID`, `CTOP` FROM `equ_factor_cf` WHERE TRADE_DATE = ? AND SECURITY_ID = ? LIMIT 200',
      [20210506, '000002.XSHE'],
    );
  });

  it('指数表：拆交易代码+市场匹配，date 型交易日转横杠日期（回归：mkt_idxd 取数失败）', async () => {
    await makeService().readTable({ table: 'mkt_idxd', fields: ['CLOSE_INDEX'], date: '20260918', security: '000001.XSHG' });
    expect(getExecute()).toHaveBeenCalledWith(
      'SELECT `TRADE_DATE`, `TICKER_SYMBOL`, `EXCHANGE_CD`, `CLOSE_INDEX` FROM `mkt_idxd` WHERE TRADE_DATE = ? AND TICKER_SYMBOL = ? AND EXCHANGE_CD = ? LIMIT 200',
      ['2026-09-18', '000001', 'XSHG'],
    );
  });

  it('证券主表：bigint SECURITY_ID 不可用 → 退到 TICKER_SYMBOL+EXCHANGE_CD，无 TRADE_DATE 忽略日期', async () => {
    await makeService().readTable({ table: 'md_security', fields: ['SEC_SHORT_NAME'], date: '20260918', security: '000002.XSHE' });
    expect(getExecute()).toHaveBeenCalledWith(
      'SELECT `TICKER_SYMBOL`, `EXCHANGE_CD`, `SEC_SHORT_NAME` FROM `md_security` WHERE TICKER_SYMBOL = ? AND EXCHANGE_CD = ? LIMIT 200',
      ['000002', 'XSHE'],
    );
  });

  it('ID 键表（md_type）：无证券/日期列 → 不加条件，仅 LIMIT 截断', async () => {
    await makeService().readTable({ table: 'md_type', fields: ['TYPE_NAME'], date: '20260918', security: '000002.XSHE' });
    expect(getExecute()).toHaveBeenCalledWith('SELECT `TYPE_NAME` FROM `md_type` LIMIT 200', []);
  });

  it('请求字段含日期列 → 去重不重复拼接', async () => {
    await makeService().readTable({ table: 'mkt_idxd', fields: ['TRADE_DATE', 'CLOSE_INDEX'], date: '20260918', security: '000001.XSHG' });
    expect(getExecute()).toHaveBeenCalledWith(
      'SELECT `TRADE_DATE`, `TICKER_SYMBOL`, `EXCHANGE_CD`, `CLOSE_INDEX` FROM `mkt_idxd` WHERE TRADE_DATE = ? AND TICKER_SYMBOL = ? AND EXCHANGE_CD = ? LIMIT 200',
      ['2026-09-18', '000001', 'XSHG'],
    );
  });
});
