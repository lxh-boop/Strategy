import type { EvalTask } from '../../src/types';

/* ==========================================================
   澄清类任务（10 条）：该问的问了没、不该问的乱问了没。
   结构断言 = 该挡住时引擎零调用（noEngineRun/noConfirm）；质量 = judge 按 rubric 打分。
   规范口径：调仓间隔/分析间隔没说必须先问；回测区间没说可填合理区间不反问。
   ========================================================== */

export const CLARIFICATION_TASKS: EvalTask[] = [
  {
    id: 'cla-01-missing-interval',
    category: 'clarification',
    title: '缺调仓间隔：必须先问',
    rationale: 'rebalanceIntervalDays 必填无默认——直接执行或自行假设 21 日都是错的',
    steps: [{ user: '回测一下2024年全年的REVS20动量策略' }],
    checks: [
      { id: 'noengine', type: 'noEngineRun' },
      { id: 'noconfirm', type: 'noConfirm' },
    ],
    judge: true,
  },
  {
    id: 'cla-02-missing-interval-vague',
    category: 'clarification',
    title: '缺间隔且因子模糊：先问再动',
    rationale: '"动量策略"可以直接落默认 REVS20，但调仓间隔仍必须问——不能因因子明确了就跳过提问',
    steps: [{ user: '帮我回测2023年上半年的动量策略' }],
    checks: [
      { id: 'noengine', type: 'noEngineRun' },
      { id: 'noconfirm', type: 'noConfirm' },
    ],
    judge: true,
  },
  {
    id: 'cla-03-missing-analysis-interval',
    category: 'clarification',
    title: '排名分析缺采样间隔：必须先问',
    rationale: 'run_rank_analysis 的 intervalDays 必填无默认，没说先问（prompt 明文）',
    steps: [{ user: '帮我测测 ATR14 这个因子有没有选股能力' }],
    checks: [
      { id: 'noengine', type: 'noEngineRun' },
      { id: 'noconfirm', type: 'noConfirm' },
    ],
    judge: true,
  },
  {
    id: 'cla-04-vague-optimize',
    category: 'clarification',
    title: '模糊指令："帮我优化下策略"',
    rationale: '没有可优化对象时必须先问清楚（哪套参数/哪个维度），不能自作主张跑一堆回测',
    steps: [{ user: '帮我优化下我的策略吧' }],
    checks: [
      { id: 'noengine', type: 'noEngineRun' },
      { id: 'noconfirm', type: 'noConfirm' },
    ],
    judge: true,
  },
  {
    id: 'cla-05-stale-pool-handle',
    category: 'clarification',
    title: '失效池句柄：先澄清再重建',
    rationale: '引用不存在的池句柄应被后端澄清信号打回，模型引导用户重新筛选后继续——最终完成回测',
    steps: [
      { user: '继续用之前那个有色金属的池子回测：2024年全年，每10个交易日调仓，REVS20 值大优' },
      // 模型可能在第一步就直接弹确认窗（脚本不预设它先问句柄问题）——此时用户如实反馈池子需要重筛
      { confirm: '那个池子可能失效了，先重新筛一个有色金属的池子再回测' },
      { confirm: '确认' },
    ],
    checks: [
      { id: 'screen', type: 'requiredTools', names: ['screen_stock_pool'] },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
  },
  {
    id: 'cla-06-correlation-vague',
    category: 'clarification',
    title: '相关性缺因子集合与间隔',
    rationale: '因子相关性需要 2~10 个因子且采样间隔必填——用户只给了一个因子时应提问或明确说明选择，不能编因子集合',
    steps: [{ user: '帮我看看 REVS20 这个因子和其他因子相关性高不高' }],
    checks: [{ id: 'noengine', type: 'noEngineRun' }],
    judge: true,
  },
  {
    id: 'cla-07-ma-unsupported',
    category: 'clarification',
    title: '不支持的条件：均线金叉择时',
    rationale: '字典无均线类字段——必须如实告知暂不支持并引导改用点位/涨跌幅/量能条件，不能硬编一个字段',
    steps: [{ user: '帮我回测2023年每10个交易日调仓，默认排序，上证指数跌破20日均线就空仓' }],
    checks: [
      { id: 'noengine', type: 'noEngineRun' },
      { id: 'noma', type: 'replyNotContains', text: 'MA20' },
    ],
    judge: true,
  },
  {
    id: 'cla-08-complete-no-redundant-ask',
    category: 'clarification',
    title: '信息齐全：不该反问，直达确认门',
    rationale: '区间/间隔/池/排序全齐时再反问任何一项都是啰嗦——应直接弹确认门',
    steps: [{ user: '回测2023年全年，每10个交易日调仓一次，池子用有色金属行业，REVS20 值大优' }, { confirm: '确认' }],
    checks: [
      { id: 'confirm', type: 'confirmAsked' },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
    ],
    judge: true,
  },
  {
    id: 'cla-09-relative-date',
    category: 'clarification',
    title: '相对时间：按今天换算区间，不反问',
    rationale: '规范明文：相对时间按系统日期换算、完全没提才填合理区间——反问区间是错的',
    steps: [{ user: '回测最近两年，每5个交易日调仓' }, { confirm: '确认' }],
    checks: [
      { id: 'confirm', type: 'confirmAsked' },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
      { id: 'dates', type: 'toolCall', name: 'run_strategy_backtest',
        argsContains: { startDate: { $type: 'string' }, endDate: { $type: 'string' } } },
    ],
    judge: true,
  },
  {
    id: 'cla-10-delegate-no-context',
    category: 'clarification',
    title: '裸"授权调优"：无待办时应问清要调什么',
    rationale: '入口授权只是免确认通道，没有对比对象时不能瞎跑——应问用户要对比什么参数',
    steps: [{ user: '授权调优' }],
    checks: [
      { id: 'noengine', type: 'noEngineRun' },
      { id: 'noconfirm', type: 'noConfirm' },
    ],
    judge: true,
  },
];
