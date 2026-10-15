/* ==========================================================
   因子取数真实库集成测试（手动）
   默认跳过，不对 CI/常规测试集造成负担；要对真库跑时打开开关：

   PowerShell:  $env:DB_IT="1"; npx jest mysql-factor-data.manual --runInBand
   Git Bash:    DB_IT=1 npx jest mysql-factor-data.manual --runInBand

   前置：.env 填好 MYSQL_USER / MYSQL_PASSWORD（库 herms_data @ 192.168.0.17）。
   用例里的 000002.XSHE @ 20210506 是库中已核实行；跑完 afterAll 会关闭连接池。
   ========================================================== */
import * as dotenv from 'dotenv';
import { ApiException } from '../../../src/common/api.exception';
import { MysqlFactorDataService } from '../../../src/core/implementations/mysql-factor-data.service';
import configuration from '../../../src/config/configuration';

const enabled = process.env.DB_IT === '1';
const describeManual = enabled ? describe : describe.skip;

describeManual('因子取数真实库（手动集成，DB_IT=1 开启）', () => {
  let svc: MysqlFactorDataService;

  beforeAll(() => {
    dotenv.config({ quiet: true });
    const configService = { getOrThrow: (key: string) => (configuration as unknown as () => Record<string, unknown>)()[key] };
    svc = new MysqlFactorDataService(configService as never);
  });

  afterAll(async () => {
    const pool = (svc as unknown as { pool?: { end(): Promise<void> } }).pool;
    if (pool) await pool.end();
  });

  it('连接 + happy path：000002.XSHE @ 20210506 取 TotalFixedAssets', async () => {
    const rows = await svc.readTable({
      table: 'equ_factor_derive',
      fields: ['TotalFixedAssets'],
      date: '20210506',
      security: '000002.XSHE',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].SECURITY_ID).toBe('000002.XSHE');
    expect(Number(rows[0].TRADE_DATE)).toBe(20210506);
    expect('TotalFixedAssets' in rows[0]).toBe(true);
  });

  it('空 fields = SELECT * 也能取回数据', async () => {
    const rows = await svc.readTable({
      table: 'equ_factor_derive',
      fields: [],
      date: '20210506',
      security: '000002.XSHE',
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('指数表：000001.XSHG 上证取 CLOSE_INDEX（回归：写死 SECURITY_ID 曾致 Unknown column 三连失败）', async () => {
    const rows = await svc.readTable({
      table: 'mkt_idxd',
      fields: ['CLOSE_INDEX'],
      date: '20210506',
      security: '000001.XSHG',
    });
    expect(rows.length).toBe(1);
    expect(rows[0].TICKER_SYMBOL).toBe('000001');
    expect(Number(rows[0].CLOSE_INDEX)).toBeGreaterThan(1000);
  });

  it('证券主表：静态表按交易代码+市场读，日期条件自动忽略', async () => {
    const rows = await svc.readTable({
      table: 'md_security',
      fields: ['SEC_SHORT_NAME'],
      date: '20210506',
      security: '000002.XSHE',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].TICKER_SYMBOL).toBe('000002');
  });

  it('白名单拦截：表不在 tables.md → 400', async () => {
    const err = (await svc
      .readTable({ table: 'not_in_dict', fields: ['ID'], date: '20210506', security: '000002.XSHE' })
      .catch((e) => e)) as ApiException;
    expect(err).toBeInstanceOf(ApiException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toContain('可用表');
  });

  it('白名单拦截：字段不在该表字典 → 400', async () => {
    const err = (await svc
      .readTable({ table: 'equ_factor_derive', fields: ['NotAField'], date: '20210506', security: '000002.XSHE' })
      .catch((e) => e)) as ApiException;
    expect(err).toBeInstanceOf(ApiException);
    expect(err.getStatus()).toBe(400);
  });

  it('白名单拦截：跨表借用字段 → 400（TotalFixedAssets 不属于 equ_factor_cf）', async () => {
    const err = (await svc
      .readTable({ table: 'equ_factor_cf', fields: ['TotalFixedAssets'], date: '20210506', security: '000002.XSHE' })
      .catch((e) => e)) as ApiException;
    expect(err).toBeInstanceOf(ApiException);
    expect(err.getStatus()).toBe(400);
  });
});
