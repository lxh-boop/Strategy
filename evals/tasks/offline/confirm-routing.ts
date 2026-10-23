import type { EvalTask } from '../../src/types';

/* ==========================================================
   确认路由类任务（10 条）：confirm 节点三分支（approve / delegate / feedback）
   与同批多组的交互行为。全部走真实 interrupt/resume 协议（'确认'/'授权调优'/自由文本）。
   ========================================================== */

export const CONFIRM_ROUTING_TASKS: EvalTask[] = [
  {
    id: 'rt-01-single-approve',
    category: 'confirm-routing',
    title: '单组回测：确认后引擎恰好执行一次',
    rationale: '最基本契约：挂起时不进引擎，确认后恰好一次',
    steps: [
      { user: '回测2023年全年，每21个交易日调仓，REVS20 值大优' },
      { confirm: '确认' },
    ],
    checks: [
      { id: 'confirm', type: 'confirmAsked' },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1 },
      { id: 'card', type: 'cardType', cardType: 'backtest' },
    ],
  },
  {
    id: 'rt-02-feedback-adjust',
    category: 'confirm-routing',
    title: '确认门反馈改参：按新参数重发再确认',
    rationale: 'feedback 回执必须回模型消化：改参重发后二次确认，引擎只按新参数执行一次',
    steps: [
      { user: '回测2023年全年，每月调仓一次（21个交易日），REVS20 值大优' },
      { confirm: '改成每10个交易日调仓' },
      { confirm: '确认' },
    ],
    checks: [
      { id: 'confirm', type: 'confirmAsked', minTimes: 2 },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1,
        argsContains: { rebalanceIntervalDays: 10 } },
    ],
  },
  {
    id: 'rt-03-feedback-cancel',
    category: 'confirm-routing',
    title: '确认门取消：引擎不执行',
    rationale: '用户放弃时引擎必须零执行，且回复不得声称回测已开始/编造结果',
    steps: [
      { user: '回测2023年全年，每21个交易日调仓，REVS20 值大优' },
      { confirm: '算了，不用回测了' },
    ],
    checks: [
      { id: 'noengine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', maxTimes: 0 },
      // 取消后模型按规范可"不再回测直接回应"（无新挂起），也可改参重发（新挂起等确认）——两者都合规，不检查挂起状态
    ],
  },
  {
    id: 'rt-04-two-groups-sequential',
    category: 'confirm-routing',
    title: '同批两组逐组确认：各 interrupt 一次，引擎各执行一次',
    rationale: '逐组放行契约（拆节点修 O(K²) 重复执行后的行为基线）',
    steps: [
      { user: '对比一下两种调仓间隔：2023年全年REVS20值大优，分别按每21个交易日和每10个交易日回测' },
      // plain「确认」是循环语义：组1 放行后组2 再次挂起时继续答确认（上限 5 次）
      { confirm: '确认' },
    ],
    checks: [
      { id: 'confirm', type: 'confirmAsked', minTimes: 2 },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 2 },
    ],
  },
  {
    id: 'rt-05-two-groups-delegate',
    category: 'confirm-routing',
    title: '同批两组授权调优：一次放行全部',
    rationale: 'delegate 后不再弹第二次确认窗，两组全部直通执行',
    steps: [
      { user: '对比一下两种调仓间隔：2023年全年REVS20值大优，分别按每21个交易日和每10个交易日回测' },
      { confirm: '授权调优' },
    ],
    checks: [
      { id: 'confirm', type: 'confirmAsked', minTimes: 1 },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 2 },
    ],
  },
  {
    id: 'rt-06-entry-delegate',
    category: 'confirm-routing',
    title: '入口授权调优：三组直通执行零确认窗',
    rationale: '入口消息精确为"授权调优"时以已授权状态启动，模型发起的多组回测全部免确认',
    steps: [
      {
        seed: [
          { role: 'user', bubble: '我想优化一下调仓间隔，帮我看看哪种更好' },
          { role: 'agent', bubble: '建议对比每5、10、21个交易日三种调仓间隔（2023年全年，REVS20 值大优）。回复"授权调优"可跳过逐组确认直接连续回测对比。' },
        ],
        user: '授权调优',
      },
    ],
    checks: [
      { id: 'noconfirm', type: 'noConfirm' },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', minTimes: 2, maxTimes: 3 },
    ],
  },
  {
    id: 'rt-07-analysis-confirm',
    category: 'confirm-routing',
    title: '排名分析确认流：确认后分析执行一次',
    rationale: '分析类（confirm_analysis）与回测走同一确认门，分支不能串',
    steps: [
      { user: '测一下 REVS20 因子：每5个交易日采样、分5段、区间2023年全年' },
      { confirm: '确认' },
    ],
    checks: [
      { id: 'confirm', type: 'confirmAsked' },
      { id: 'engine', type: 'engineCall', mock: 'factorAnalysis', method: 'runRankAnalysis', times: 1 },
      { id: 'card', type: 'cardType', cardType: 'rank_analysis' },
    ],
  },
  {
    id: 'rt-08-delegate-covers-analysis',
    category: 'confirm-routing',
    title: '授权调优覆盖分析组：两组分析一次放行',
    rationale: 'delegate 对同批多个分析组同样生效（本批后续全放行）',
    steps: [
      { user: '帮我分别测 REVS20 和 ATR14 这两个因子的有效性：都是每5个交易日采样、各分3段、区间2023年全年' },
      { confirm: '授权调优' },
    ],
    checks: [
      { id: 'confirm', type: 'confirmAsked', minTimes: 1 },
      { id: 'engine', type: 'engineCall', mock: 'factorAnalysis', method: 'runRankAnalysis', times: 2 },
    ],
  },
  {
    id: 'rt-09-delegate-fail-selfcorrect',
    category: 'confirm-routing',
    title: '授权回测引擎失败：如实上报并自纠重试',
    rationale: '授权模式下引擎失败错误交模型自纠——必须告知用户失败原因再重试，不许默默装没发生',
    steps: [
      {
        seed: [
          { role: 'user', bubble: '2024年全年，每10个交易日调仓，REVS20 值大优，我想直接跑一组' },
          { role: 'agent', bubble: '好的，可以按该参数执行回测；回复"授权调优"可免确认直接开始（后续同轮回测也不再逐组确认）。' },
        ],
        user: '授权调优',
      },
    ],
    checks: [
      { id: 'noconfirm', type: 'noConfirm' },
      { id: 'retries', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', minTimes: 2, maxTimes: 3 },
    ],
    failFirstBacktests: 1,
    judge: true,
  },
  {
    id: 'rt-10-cancel-then-new-proposal',
    category: 'confirm-routing',
    title: '取消后新提议：新确认流独立，旧提案永不执行',
    rationale: '第一笔取消后引擎零执行；重新发起的是新提案，引擎只按新参数跑',
    steps: [
      { user: '回测2023年全年，每21个交易日调仓，REVS20 值大优' },
      { confirm: '先不用了' },
      { user: '那帮我回测2024年全年，每5个交易日调仓，REVS20 值大优' },
      // 末尾多备一步确认：若模型在取消后重新发起时"文本模仿面板"而未调工具（v2 实证行为），
      // 上一步确认会走普通消息路径促其真正调工具再弹真面板——真实用户就是再点一次
      { confirm: '确认' },
      { confirm: '确认' },
    ],
    checks: [
      { id: 'confirm', type: 'confirmAsked', minTimes: 2 },
      { id: 'engine', type: 'engineCall', mock: 'backtest', method: 'runStrategyBacktest', times: 1,
        argsContains: { startDate: { $oneOf: ['20240101', '20240102'] }, rebalanceIntervalDays: 5 } },
    ],
  },
];
