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
      () => makeService().readTable({ ...baseQuery, table: 'md_security' }),
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
