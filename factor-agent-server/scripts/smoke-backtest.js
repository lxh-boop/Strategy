/**
 * 策略回测冒烟脚本：不起 Nest 服务，直接装配 MysqlFactorDataService + StrategyBacktestServiceImpl
 * 打真实库，验证"交易日 → 因子截面过滤排序 → 日频事件内核（T+1/整手/资金账户）→ 基准 → 卡片"全链路。
 *
 * 用法（在 factor-agent-server 目录下）：
 *   node scripts/smoke-backtest.js [字段1,字段2,...] [开始日YYYYMMDD] [结束日YYYYMMDD] [调仓间隔交易日] [持仓只数]
 *
 *   字段支持方向后缀 ":-1"（值小优），缺省 direction=1（值大优）；多个字段 = 多因子合成（缺省等权）。
 *
 * 示例：
 *   node scripts/smoke-backtest.js                                    # 默认组合（20日动量月调仓全市场 Top-10）
 *   node scripts/smoke-backtest.js REVS20 20240101 20241231 21 10
 *   node scripts/smoke-backtest.js REVS20,RSI:-1 20240101 20241231 21 10   # 双因子（RSI 值小优）
 *   node scripts/smoke-backtest.js REVS20 20240101 20241231 "" 10     # 缺调仓间隔 → 应报澄清信号
 *
 * 前置：.env 里填好 MYSQL_USER / MYSQL_PASSWORD。
 */
require('dotenv').config({ quiet: true });

const configuration = require('../dist/config/configuration').default;
const { MysqlFactorDataService } = require('../dist/core/implementations/mysql-factor-data.service');
const { StrategyBacktestServiceImpl } = require('../dist/core/implementations/strategy-backtest.service.impl');

const [fieldsArg = 'REVS20', start = '20240101', end = '20241231', interval = '21', maxPositions = '10'] =
  process.argv.slice(2);

const factorData = new MysqlFactorDataService({ getOrThrow: (key) => configuration()[key] });
const backtest = new StrategyBacktestServiceImpl(factorData);

const input = { startDate: start, endDate: end };
if (interval) input.rebalanceIntervalDays = Number(interval); // 不传 → 验证"缺调仓间隔 → 澄清信号"
if (maxPositions) input.maxPositions = Number(maxPositions);
input.sortFactors = String(fieldsArg)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((raw) => {
    const [field, dir] = raw.split(':');
    return dir ? { table: 'equ_factor_obos', field, direction: Number(dir) } : { table: 'equ_factor_obos', field, direction: 1 };
  });

backtest
  .runStrategyBacktest(input)
  .then(({ card, summary }) => {
    console.log('===== 摘要（给 LLM） =====');
    console.log(JSON.stringify(summary, null, 2));
    console.log('===== 卡片 =====');
    console.log(`tag=${card.tag}  title=${card.title}`);
    console.log(`note=${card.note}`);
    console.log(`curve ${card.curve.length} 点，头 5：${JSON.stringify(card.curve.slice(0, 5))}，尾 5：${JSON.stringify(card.curve.slice(-5))}`);
    console.log(`bench(${card.benchName}) ${card.benchCurve.length} 点，头 5：${JSON.stringify(card.benchCurve.slice(0, 5))}`);
    console.log('metrics:', card.metrics.map((m) => `${m.label}=${m.value}`).join('  '));
    console.log(`trades ${card.trades.length} 笔（卡片截选），头 3：`);
    for (const t of card.trades.slice(0, 3)) {
      console.log(`  ${t.date} ${t.direction === 'buy' ? '买' : '卖'} ${t.code} ${t.shares}股 @${t.price} 费${t.fee.toFixed(0)} [${t.reason}]`);
    }
    console.log(`monthly ${card.monthly.length} 个月：${card.monthly.map((m) => `${m.month}=${m.pct}%`).join(' ')}`);
    process.exit(0);
  })
  .catch((error) => {
    const resp = typeof error.getResponse === 'function' ? error.getResponse() : null;
    if (resp) console.error(`FAIL [${error.getStatus()}] ${resp.code}: ${resp.message}`);
    else console.error(`FAIL ${error.name}: ${error.message}`);
    process.exit(1);
  });
