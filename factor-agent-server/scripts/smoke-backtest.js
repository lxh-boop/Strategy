/**
 * 等权回测冒烟脚本：不起 Nest 服务，直接装配 MysqlFactorDataService + EqualWeightBacktestServiceImpl
 * 打真实库，验证"交易日 → 多因子截面合成 → 年度收盘 → 指数基准 → 卡片"全链路。
 *
 * 用法（在 factor-agent-server 目录下）：
 *   node scripts/smoke-backtest.js [表名] [字段1,字段2,...] [开始日YYYYMMDD] [结束日YYYYMMDD] [频率] [topK]
 *
 *   字段支持方向后缀 ":asc"（值越小越好），缺省 desc；多个字段 = 多因子等权合成。
 *
 * 示例：
 *   node scripts/smoke-backtest.js                                              # 默认组合（单因子月度 Top-10）
 *   node scripts/smoke-backtest.js equ_factor_derive NetProfitTTM 20240101 20241231 monthly 10
 *   node scripts/smoke-backtest.js equ_factor_derive EBIT,ROC:asc 20240101 20241231 monthly 10   # 双因子
 *   node scripts/smoke-backtest.js equ_factor_derive EBIT 20240101 20241231 custom 10 15          # 每15个交易日
 *   node scripts/smoke-backtest.js equ_factor_derive EBIT 20240101 20241231 "" 10                 # 缺频率 → 应报澄清信号
 *
 * 前置：.env 里填好 MYSQL_USER / MYSQL_PASSWORD。
 */
require('dotenv').config({ quiet: true });

const configuration = require('../dist/config/configuration').default;
const { MysqlFactorDataService } = require('../dist/core/implementations/mysql-factor-data.service');
const { EqualWeightBacktestServiceImpl } = require('../dist/core/implementations/equal-weight-backtest.service.impl');

const [table = 'equ_factor_derive', fieldsArg = 'NetProfitTTM', start = '20240101', end = '20241231', frequency = 'monthly', topK = '10'] =
  process.argv.slice(2);

const factorData = new MysqlFactorDataService({ getOrThrow: (key) => configuration()[key] });
const backtest = new EqualWeightBacktestServiceImpl(factorData);

const input = { startDate: start, endDate: end };
if (frequency) input.frequency = frequency; // 不传 → 验证"缺 frequency → 澄清信号"
if (topK) input.topK = Number(topK);
input.factors = String(fieldsArg)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((raw) => {
    const [field, order] = raw.split(':');
    return order ? { table, field, order } : { table, field };
  });

backtest
  .runEqualWeightBacktest(input)
  .then(({ card, summary }) => {
    console.log('===== 摘要（给 LLM） =====');
    console.log(JSON.stringify(summary, null, 2));
    console.log('===== 卡片 =====');
    console.log(`tag=${card.tag}  title=${card.title}`);
    console.log(`note=${card.note}`);
    console.log(`curve ${card.curve.length} 点，头 5：${JSON.stringify(card.curve.slice(0, 5))}，尾 5：${JSON.stringify(card.curve.slice(-5))}`);
    console.log(`bench(${card.benchName}) ${card.benchCurve.length} 点，头 5：${JSON.stringify(card.benchCurve.slice(0, 5))}`);
    console.log('metrics:', card.metrics.map((m) => `${m.label}=${m.value}`).join('  '));
    process.exit(0);
  })
  .catch((error) => {
    const resp = typeof error.getResponse === 'function' ? error.getResponse() : null;
    if (resp) console.error(`FAIL [${error.getStatus()}] ${resp.code}: ${resp.message}`);
    else console.error(`FAIL ${error.name}: ${error.message}`);
    process.exit(1);
  });
