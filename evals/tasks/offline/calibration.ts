import type { EvalTask } from '../../src/types';
import { D2015TO2016, D2023, D2024H1, D2024H2 } from './helpers';

/* ==========================================================
   口径类任务（20 条）：用户口径是否完整、准确地传到工具调用。
   断言点 = 模型提出的原始参数（toolCall）；涉及引擎归一化的再断 engineCall。
   区间期望用日历口径二选一（helpers，见文件头注释），相对时间只断 8 位字符串。
   ========================================================== */

export const CALIBRATION_TASKS: EvalTask[] = [
  {
    id: 'cal-01-interval-sort',
    category: 'calibration',
    title: '基础回测：区间 + 调仓间隔 + 排序因子方向',
    rationale: '三个用户口径（区间/间隔/REVS20 值大优）必须完整进 run_strategy_backtest',
    steps: [{ user: '帮我回测一下：2023年全年，每10个交易日调仓，用 REVS20 因子值大优先买入' }, { confirm: '确认' }],
    checks: [
      {
        id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: {
          ...D2023, rebalanceIntervalDays: 10,
          sortFactors: [{ table: 'equ_factor_obos', field: 'REVS20', direction: 1 }],
        },
      },
      { id: 'confirm', type: 'confirmAsked' },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
      { id: 'card', type: 'cardType', cardType: 'backtest' },
    ],
  },
  {
    id: 'cal-02-default-sort',
    category: 'calibration',
    title: '不提排序因子：缺省走默认 20 日动量',
    rationale: '用户没提排序时不应凭空传 sortFactors（引擎默认 REVS20 值大优）；区间相对表达只断 8 位字符串',
    steps: [{ user: '回测最近一年，每10个交易日调仓一次' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { rebalanceIntervalDays: 10, startDate: { $type: 'string' }, endDate: { $type: 'string' }, sortFactors: undefined } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-03-reverse-direction',
    category: 'calibration',
    title: '值小优方向：BIAS20 低乖离排序',
    rationale: 'direction=-1 必须落在排序因子上，不能丢方向或反向',
    steps: [{ user: '回测2024年下半年：每5个交易日调仓，按 BIAS20 二十日乖离率值小优先买（低乖离超跌反弹思路）' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { ...D2024H2, rebalanceIntervalDays: 5,
          sortFactors: [{ table: 'equ_factor_obos', field: 'BIAS20', direction: -1 }] } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-04-timing-close',
    category: 'calibration',
    title: '尾盘单成交：executionTiming=2',
    rationale: '用户说"当天收盘出信号当天成交"必须传 executionTiming=2（ADR-0008 尾盘单）',
    steps: [{ user: '2024年上半年回测，每5个交易日调仓，REVS20 值大优，用尾盘单：当日收盘出信号当日成交' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { ...D2024H1, executionTiming: 2 } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-05-limit-off',
    category: 'calibration',
    title: '对照模式：显式关闭涨跌停判定',
    rationale: '用户明确要求对照口径时才允许 limitUpDownSkip=false（ADR-0009 默认开）',
    steps: [{ user: '我要和掘金做复刻对照，把涨跌停判定关掉再回测：2023年全年，每21个交易日调仓，默认排序' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { ...D2023, limitUpDownSkip: false } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-06-fee',
    category: 'calibration',
    title: '费率换算：万五单边',
    rationale: '口头费率（万五）必须换算成小数 feeRate=0.0005',
    steps: [{ user: '回测2023年全年，每10个交易日调仓，默认排序，手续费按万五' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest', argsContains: { ...D2023, feeRate: 0.0005 } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-07-capital-benchmark',
    category: 'calibration',
    title: '资金与基准：200 万初始资金 + 中证500 基准',
    rationale: 'initialCapital 数值与 benchmark 枚举（csi500）都要落对',
    steps: [{ user: '初始资金200万，基准用中证500，回测2023年全年每21个交易日调仓，默认排序' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { ...D2023, initialCapital: 2000000, benchmark: 'csi500' } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-08-position-size',
    category: 'calibration',
    title: '持仓结构：20 只 × 每只 4%',
    rationale: 'maxPositions 与 idealPositionPct 是两个独立旋钮，必须同时正确',
    steps: [{ user: '回测2023年全年每10个交易日调仓，默认排序，持仓20只，每只仓位4%' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { maxPositions: 20, idealPositionPct: 4 } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-09-index-pool',
    category: 'calibration',
    title: '指数池：先筛沪深300再回测（poolId 句柄）',
    rationale: '成分池禁止手拼清单：必须 screen_stock_pool（index 组 000300.SH）→ 回测传 poolId',
    steps: [{ user: '在沪深300里回测：2023年全年，每10个交易日调仓，REVS20 值大优' }, { confirm: '确认' }],
    checks: [
      { id: 'screen', type: 'toolCall', name: 'screen_stock_pool',
        argsContains: { groups: [{ kind: 'index', codes: ['000300.SH'] }] } },
      { id: 'poolid', type: 'toolCall', name: 'run_strategy_backtest', argsContains: { poolId: { $type: 'string' } } },
      { id: 'nosids', type: 'toolCall', name: 'run_strategy_backtest', argsContains: { securityIds: undefined } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-10-industry-pool',
    category: 'calibration',
    title: '行业池：有色金属 ∪ 煤炭（field 组组内并集）',
    rationale: '同组两取值是并集语义：一个 field 组放两个 values，不能拆成两组（组间是交集）；行业粒度由字段承载（l1_name）',
    steps: [{ user: '只做有色金属和煤炭这两类股票：2023年全年每10个交易日调仓，REVS20 值大优，帮我回测' }, { confirm: '确认' }],
    checks: [
      { id: 'screen', type: 'toolCall', name: 'screen_stock_pool',
        argsContains: { groups: [{ kind: 'field', table: 'sw_member', field: 'l1_name', values: ['有色金属', '煤炭'] }] } },
      { id: 'poolid', type: 'toolCall', name: 'run_strategy_backtest', argsContains: { poolId: { $type: 'string' } } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-11-list-pool',
    category: 'calibration',
    title: '点名清单：直接传 securityIds 不建池',
    rationale: '用户点名少量股票时规范是直接传 securityIds（不必走筛选工具）',
    steps: [{ user: '就做这三只：600519、000858、601318，别建池子，直接回测2023年全年每21个交易日调仓，默认排序' }, { confirm: '确认' }],
    checks: [
      { id: 'sids', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { securityIds: ['600519.XSHG', '000858.XSHE', '601318.XSHG'] } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-12-entryfilter-index',
    category: 'calibration',
    title: '大盘开关：上证 3000 点上方才买入',
    rationale: 'entryFilters 引用 mkt_idxd.CLOSE_INDEX（大盘条件，缺省挂上证），op 为 ">"',
    steps: [{ user: '回测2023年全年每10个交易日调仓，默认排序；加个条件：上证指数在3000点上方时才买入' }, { confirm: '确认' }],
    checks: [
      { id: 'filter', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { entryFilters: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 3000 }] } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-13-timing-overlay',
    category: 'calibration',
    title: '大盘择时：跌破 3000 点空仓',
    rationale: '总仓位意图必须走 timingOverlay（rules 引用 CLOSE_INDEX ">" 3000 由熊转牛 + 熊市空仓缺省），不是 entryFilters',
    steps: [{ user: '回测2023年全年每10个交易日调仓，默认排序；如果上证跌破3000点就整体空仓，涨回来再恢复' }, { confirm: '确认' }],
    checks: [
      { id: 'overlay', type: 'toolCall', name: 'run_strategy_backtest',
        // 规则语义 = 由熊转牛的入场条件（timing.ts：全部条件满足由熊转牛，牛市满仓/熊市 bearPositionPct），
        // "跌破3000空仓" = CLOSE_INDEX > 3000 + bearPositionPct 缺省 0。期望曾误写为 '<'（v1/v2 反向口径，v3 修正）
        argsContains: { timingOverlay: { bearPositionPct: 0, rules: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 3000 }] } } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-14-exclude-ranges',
    category: 'calibration',
    title: '排除时间段：剔除 2015 股灾段',
    rationale: 'excludeRanges 两端日期要完整落成 [{start,end}]（纯数字 YYYYMMDD）',
    steps: [{ user: '回测2015年1月到2016年12月，每10个交易日调仓，默认排序；把2015年6月到2016年1月那段股灾剔除掉' }, { confirm: '确认' }],
    checks: [
      { id: 'ranges', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { ...D2015TO2016, excludeRanges: [{ start: '20150601', end: { $oneOf: ['20160131', '20160129'] } }] } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-15-sellrules',
    category: 'calibration',
    title: '卖出规则：止盈 20% + 止损 10% + 跌出前 10',
    rationale: '三种卖出规则（pct×2 与 bottomN）同时表达时各自字段都要落对',
    steps: [{ user: '回测2023年全年每10个交易日调仓，REVS20 值大优；止盈20%、止损10%，跌出综合分前10名也卖' }, { confirm: '确认' }],
    checks: [
      { id: 'rules', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { sellRules: [{ kind: 'stop_profit', pct: 20 }, { kind: 'stop_loss', pct: 10 }, { kind: 'rank_out', bottomN: 10 }] } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-16-keep-rules',
    category: 'calibration',
    title: '不卖条件：REVS20 大于 0 不卖',
    rationale: 'keepRules 与 sellRules 是两根独立管道，"强势不卖"必须进 keepRules',
    steps: [{ user: '回测2023年全年每10个交易日调仓，REVS20 值大优，止损10%；另外 REVS20 还大于0的强势股不要卖' }, { confirm: '确认' }],
    checks: [
      { id: 'keep', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { keepRules: [{ table: 'equ_factor_obos', field: 'REVS20', op: '>', value: 0 }] } },
      { id: 'stop', type: 'toolCall', name: 'run_strategy_backtest', argsContains: { sellRules: [{ kind: 'stop_loss', pct: 10 }] } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-17-weightfn',
    category: 'calibration',
    title: '权重函数：constant_weights 按因子序 1:2',
    rationale: '因子权重走 weightFn {name,params}（函数字典 v1），ATR14 权重两倍于 REVS20 → weights=[1,2]',
    steps: [{ user: '回测2023年全年每10个交易日调仓，排序用 REVS20 和 ATR14 都是值大优，ATR14 的权重是 REVS20 的两倍' }, { confirm: '确认' }],
    checks: [
      { id: 'sort', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { sortFactors: [{ field: 'REVS20', direction: 1 }, { field: 'ATR14', direction: 1 }] } },
      { id: 'wfn', type: 'toolCall', name: 'run_strategy_backtest', argsContains: { weightFn: { name: 'constant_weights' } } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-18-trigger-mode',
    category: 'calibration',
    title: '触发模式（模型Ⅱ）：间隔 0 + 偏离带 25% + 预声明清单',
    rationale: 'rebalanceIntervalDays=0 必须伴随 positionDeviatePct 与 securityIds 触发域（ADR-0008）',
    steps: [{ user: '我不按固定日子调仓：就做 600519 和 000858 这两只，偏离目标仓位超过25%才再平衡，回测2023年全年，默认排序' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { rebalanceIntervalDays: 0, positionDeviatePct: 25, securityIds: ['600519.XSHG', '000858.XSHE'] } },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cal-19-rank-analysis',
    category: 'calibration',
    title: '排名分析：因子/间隔/分段数三口径',
    rationale: 'run_rank_analysis 的 factor 结构与 intervalDays/segmentCount 必须与用户口径一致',
    steps: [{ user: '帮我做个排名分析：REVS20 这个因子，每5个交易日采样一次，分3段，区间2023年全年' }, { confirm: '确认' }],
    checks: [
      { id: 'args', type: 'toolCall', name: 'run_rank_analysis',
        argsContains: { factor: { table: 'equ_factor_obos', field: 'REVS20', direction: 1 }, segmentCount: 3, intervalDays: 5, ...D2023 } },
      { id: 'confirm', type: 'confirmAsked' },
      { id: 'engine', type: 'engineCall', mock: 'factorAnalysis', method: 'runRankAnalysis', times: 1 },
      { id: 'card', type: 'cardType', cardType: 'rank_analysis' },
    ],
  },
  {
    id: 'cal-20-daily-screen',
    category: 'calibration',
    title: '每日选股：默认排序免确认直查',
    rationale: 'run_daily_screen 只读免确认（不弹确认门）；缺省排序 = 默认 20 日动量',
    steps: [{ user: '按默认的20日动量排序，帮我看看今天选出哪些股票' }],
    checks: [
      { id: 'noconfirm', type: 'noConfirm' },
      { id: 'screen', type: 'engineCall', mock: 'backtest', method: 'runDailyScreen', minTimes: 1 },
      { id: 'card', type: 'cardType', cardType: 'screen' },
    ],
  },
];
