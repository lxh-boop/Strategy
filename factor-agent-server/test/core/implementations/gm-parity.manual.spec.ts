/* ==========================================================
   掘金对照实验（手动，DB_IT=1 开启）：
   掘金版 2025 全年 +4.27% vs 自研同参数历史结果 +53.5%，差距归因。
   A 组=掘金版参数原样（静态 154 只清单 + REVS20 单因子 + 三条行情过滤）
   B 组=A 组 + NetProfitTTM 过滤与双因子排序（隔离因子贡献）
   C 组参照（已发生）=2025 PIT 行业池 148 只 + 双因子 = 年化 +53.5%
   A≈掘金 ⇒ 翻译无误、差距来自因子/池子；A 远高于掘金 ⇒ 掘金版有 bug。
   ========================================================== */
import * as dotenv from 'dotenv';
import { MysqlFactorDataService } from '../../../src/core/implementations/mysql-factor-data.service';
import { StrategyBacktestServiceImpl } from '../../../src/core/implementations/strategy-backtest.service.impl';
import { StrategyBacktestInput } from '../../../src/core/strategy-backtest.service';
import configuration from '../../../src/config/configuration';

const enabled = process.env.DB_IT === '1';
const describeManual = enabled ? describe : describe.skip;

/** 掘金静态清单（SHSE.→.XSHG / SZSE.→.XSHE），与 main.py 同源 */
const GM_POOL = [
    'SHSE.600111', 'SHSE.600205', 'SHSE.600219', 'SHSE.600255', 'SHSE.600259', 'SHSE.600281',
    'SHSE.600296', 'SHSE.600301', 'SHSE.600311', 'SHSE.600338', 'SHSE.600361', 'SHSE.600362',
    'SHSE.600366', 'SHSE.600392', 'SHSE.600432', 'SHSE.600456', 'SHSE.600459', 'SHSE.600472',
    'SHSE.600489', 'SHSE.600490', 'SHSE.600497', 'SHSE.600531', 'SHSE.600547', 'SHSE.600549',
    'SHSE.600595', 'SHSE.600614', 'SHSE.600615', 'SHSE.600687', 'SHSE.600711', 'SHSE.600768',
    'SHSE.600888', 'SHSE.600961', 'SHSE.600988', 'SHSE.601020', 'SHSE.601028', 'SHSE.601069',
    'SHSE.601137', 'SHSE.601168', 'SHSE.601212', 'SHSE.601388', 'SHSE.601600', 'SHSE.601609',
    'SHSE.601677', 'SHSE.601702', 'SHSE.601899', 'SHSE.601958', 'SHSE.603045', 'SHSE.603072',
    'SHSE.603124', 'SHSE.603132', 'SHSE.603271', 'SHSE.603399', 'SHSE.603407', 'SHSE.603527',
    'SHSE.603799', 'SHSE.603876', 'SHSE.603937', 'SHSE.603978', 'SHSE.603979', 'SHSE.603993',
    'SHSE.605158', 'SHSE.605208', 'SHSE.605376', 'SHSE.688077', 'SHSE.688102', 'SHSE.688190',
    'SHSE.688231', 'SHSE.688456', 'SHSE.688750', 'SHSE.688786', 'SHSE.688811', 'SZSE.000060',
    'SZSE.000405', 'SZSE.000426', 'SZSE.000506', 'SZSE.000603', 'SZSE.000612', 'SZSE.000630',
    'SZSE.000633', 'SZSE.000657', 'SZSE.000688', 'SZSE.000689', 'SZSE.000693', 'SZSE.000737',
    'SZSE.000751', 'SZSE.000758', 'SZSE.000762', 'SZSE.000795', 'SZSE.000807', 'SZSE.000831',
    'SZSE.000878', 'SZSE.000933', 'SZSE.000960', 'SZSE.000962', 'SZSE.000969', 'SZSE.000970',
    'SZSE.000975', 'SZSE.001246', 'SZSE.001257', 'SZSE.001280', 'SZSE.001337', 'SZSE.002070',
    'SZSE.002114', 'SZSE.002149', 'SZSE.002155', 'SZSE.002160', 'SZSE.002167', 'SZSE.002171',
    'SZSE.002182', 'SZSE.002192', 'SZSE.002203', 'SZSE.002237', 'SZSE.002240', 'SZSE.002295',
    'SZSE.002378', 'SZSE.002379', 'SZSE.002428', 'SZSE.002460', 'SZSE.002466', 'SZSE.002501',
    'SZSE.002502', 'SZSE.002532', 'SZSE.002540', 'SZSE.002578', 'SZSE.002716', 'SZSE.002738',
    'SZSE.002756', 'SZSE.002824', 'SZSE.002842', 'SZSE.002978', 'SZSE.002988', 'SZSE.002996',
    'SZSE.003038', 'SZSE.300057', 'SZSE.300127', 'SZSE.300139', 'SZSE.300224', 'SZSE.300328',
    'SZSE.300337', 'SZSE.300618', 'SZSE.300697', 'SZSE.300748', 'SZSE.300811', 'SZSE.300835',
    'SZSE.300855', 'SZSE.300930', 'SZSE.300963', 'SZSE.301026', 'SZSE.301141', 'SZSE.301219',
    'SZSE.301323', 'SZSE.301522', 'SZSE.301531', 'SZSE.301622',
].map((s) => (s.startsWith('SHSE.') ? s.replace('SHSE.', '') + '.XSHG' : s.replace('SZSE.', '') + '.XSHE'));

describeManual('掘金对照实验（手动，DB_IT=1 开启）', () => {
  let svc: StrategyBacktestServiceImpl;
  let factorData: MysqlFactorDataService;

  beforeAll(() => {
    dotenv.config({ quiet: true });
    const configService = { getOrThrow: (key: string) => (configuration as unknown as () => Record<string, unknown>)()[key] };
    factorData = new MysqlFactorDataService(configService as never);
    svc = new StrategyBacktestServiceImpl(factorData);
  });

  afterAll(async () => {
    const pool = (factorData as unknown as { pool?: { end(): Promise<void> } }).pool;
    if (pool) await pool.end();
  });

  const baseInput: StrategyBacktestInput = {
    securityIds: GM_POOL,
    startDate: '20250101',
    endDate: '20251231',
    initialCapital: 1_000_000,
    feeRate: 0.0003,
    rebalanceIntervalDays: 21,
    executionTiming: 0,
    maxPositions: 10,
    benchmark: 'hs300',
    entryFilters: [
      { table: 'equ_factor_obos', field: 'BIAS60', op: '>', value: 0 },
      { table: 'equ_factor_obos', field: 'REVS20', op: '>', value: 1 },
      { table: 'equ_factor_obos', field: 'Volumn3M', op: '>', value: 0 },
    ],
    sellRules: [
      { kind: 'field', table: 'equ_factor_obos', field: 'BIAS20', op: '<', value: 0 },
      { kind: 'rank_out', bottomN: 10 },
    ],
  };

  it('A 组：掘金版参数原样（单因子）', async () => {
    const out = await svc.runStrategyBacktest({ ...baseInput, sortFactors: [{ table: 'equ_factor_obos', field: 'REVS20', direction: 1 }] });
    console.log('[A 静态154+单因子]', JSON.stringify({
      年化: out.summary.年化收益, 回撤: out.summary.最大回撤, 夏普: out.summary.夏普比率,
      胜率: out.summary.胜率, 基准: out.summary.基准, 交易: out.summary.交易笔数,
    }));
  }, 600_000);

  it('B 组：A + NetProfitTTM 过滤与双因子（隔离因子贡献）', async () => {
    const out = await svc.runStrategyBacktest({
      ...baseInput,
      sortFactors: [
        { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
        { table: 'equ_factor_derive', field: 'NetProfitTTM', direction: 1 },
      ],
      entryFilters: [
        { table: 'equ_factor_obos', field: 'BIAS60', op: '>', value: 0 },
        { table: 'equ_factor_obos', field: 'REVS20', op: '>', value: 1 },
        { table: 'equ_factor_obos', field: 'Volumn3M', op: '>', value: 0 },
        { table: 'equ_factor_derive', field: 'NetProfitTTM', op: '>', value: 0 },
      ],
    });
    console.log('[B 静态154+双因子]', JSON.stringify({
      年化: out.summary.年化收益, 回撤: out.summary.最大回撤, 夏普: out.summary.夏普比率,
      胜率: out.summary.胜率, 基准: out.summary.基准, 交易: out.summary.交易笔数,
    }));
  }, 600_000);
});
