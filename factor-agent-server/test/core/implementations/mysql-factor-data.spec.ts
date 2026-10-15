/* ==========================================================
   因子取数（MysqlFactorDataService）单元测试 —— SQL 拼装与错误包装。
   白名单 / 入参格式校验已在 mysql-factor-data.service.spec.ts 覆盖，
   SQL 形状按表字典的推导覆盖在 mysql-factor-data.readtable.spec.ts，
   本文件只钉：SELECT 列清单拼装（键列去重 / SELECT *）、
   字段数上限、连接池懒创建、DB 错误 → 502 DATA_SOURCE_ERROR。
   mysql2/promise 为 mock，不连真库。
   运行：npx jest mysql-factor-data.spec
   ========================================================== */
jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));

import { createPool } from 'mysql2/promise';
import { ApiException } from '../../../src/common/api.exception';
import { MysqlFactorDataService } from '../../../src/core/implementations/mysql-factor-data.service';

const execute = jest.fn();
const mysqlConfig = {
  host: '127.0.0.1',
  port: 3306,
  user: 'u',
  password: 'p',
  database: 'herms_data',
  connectionLimit: 5,
};
const configService = { getOrThrow: jest.fn(() => mysqlConfig) };

const makeSvc = () => new MysqlFactorDataService(configService as never);

const expectApiException = async (run: () => Promise<unknown>, code: string, msgPart: string) => {
  const err = (await run().catch((e) => e)) as ApiException;
  expect(err).toBeInstanceOf(ApiException);
  expect(err.code).toBe(code);
  expect(err.message).toContain(msgPart);
};

describe('因子取数 MysqlFactorDataService（SQL 拼装与错误包装）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPool as jest.Mock).mockReturnValue({ execute });
  });

  it('合法取数：拼出预期 SQL 并返回行', async () => {
    const row = { SECURITY_ID: '000002.XSHE', TRADE_DATE: 20210506, TotalFixedAssets: '15681149891.2200' };
    execute.mockResolvedValue([[row], []]);

    const rows = await makeSvc().readTable({
      table: 'equ_factor_derive',
      fields: ['TotalFixedAssets', 'IntFreeCL'],
      date: '20210506',
      security: '000002.XSHE',
    });

    expect(execute).toHaveBeenCalledWith(
      'SELECT `TRADE_DATE`, `SECURITY_ID`, `TotalFixedAssets`, `IntFreeCL` ' +
        'FROM `equ_factor_derive` WHERE TRADE_DATE = ? AND SECURITY_ID = ? LIMIT 200',
      [20210506, '000002.XSHE'],
    );
    expect(rows).toEqual([row]);
  });

  it('空 fields = SELECT *（不拼具体列）', async () => {
    execute.mockResolvedValue([[], []]);
    await makeSvc().readTable({ table: 'equ_factor_cf', fields: [], date: '20210506', security: '000002.XSHE' });
    expect(execute).toHaveBeenCalledWith(
      'SELECT * FROM `equ_factor_cf` WHERE TRADE_DATE = ? AND SECURITY_ID = ? LIMIT 200',
      [20210506, '000002.XSHE'],
    );
  });

  it('调用方传入固定键列时去重，不产生重复列', async () => {
    execute.mockResolvedValue([[], []]);
    await makeSvc().readTable({
      table: 'equ_factor_derive',
      fields: ['SECURITY_ID', 'TotalFixedAssets', 'TRADE_DATE'],
      date: '20210506',
      security: '000002.XSHE',
    });
    expect(execute).toHaveBeenCalledWith(
      'SELECT `TRADE_DATE`, `SECURITY_ID`, `TotalFixedAssets` FROM `equ_factor_derive` WHERE TRADE_DATE = ? AND SECURITY_ID = ? LIMIT 200',
      [20210506, '000002.XSHE'],
    );
  });

  it('因子字段超过上限（200）→ 400，且在白名单检查前拦截', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `F${i}`);
    await expectApiException(
      () =>
        makeSvc().readTable({
          table: 'equ_factor_derive',
          fields: many,
          date: '20210506',
          security: '000002.XSHE',
        }),
      'INVALID_ARGUMENT',
      '因子字段过多',
    );
  });

  it('MySQL 未配置 → 502 且不建连接池', async () => {
    const emptyConfig = { getOrThrow: () => ({ ...mysqlConfig, user: '' }) };
    const err = (await new MysqlFactorDataService(emptyConfig as never)
      .readTable({ table: 'equ_factor_derive', fields: ['EBITDA'], date: '20210506', security: '000002.XSHE' })
      .catch((e) => e)) as ApiException;
    expect(err).toBeInstanceOf(ApiException);
    expect(err.code).toBe('DATA_SOURCE_ERROR');
    expect(err.getStatus()).toBe(502);
    expect(createPool).not.toHaveBeenCalled();
  });

  it('数据库错误 → 包装为 502 DATA_SOURCE_ERROR', async () => {
    execute.mockRejectedValue(new Error('connect ECONNREFUSED 192.168.0.17:3306'));
    const err = (await makeSvc()
      .readTable({ table: 'equ_factor_derive', fields: ['EBITDA'], date: '20210506', security: '000002.XSHE' })
      .catch((e) => e)) as ApiException;
    expect(err).toBeInstanceOf(ApiException);
    expect(err.code).toBe('DATA_SOURCE_ERROR');
    expect(err.getStatus()).toBe(502);
    expect(err.message).toContain('ECONNREFUSED');
  });
});
