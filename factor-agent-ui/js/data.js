/* ==========================================================
   模拟数据层 — 纯前端演示用，后续可替换为后端 API
   ========================================================== */

// 因子库
const FACTOR_LIB = [
  { id: "value",    name: "价值因子",   desc: "EP、BP、股息率" },
  { id: "growth",   name: "成长因子",   desc: "营收增速、净利润增速" },
  { id: "momentum", name: "动量因子",   desc: "20日/60日相对强弱" },
  { id: "quality",  name: "质量因子",   desc: "ROE、毛利率、现金流" },
  { id: "lowvol",   name: "低波动因子", desc: "波动率、特异波动" },
  { id: "dividend", name: "股息率因子", desc: "近12个月股息率" },
  { id: "liquidity",name: "流动性因子", desc: "换手率、成交额" },
  { id: "size",     name: "市值因子",   desc: "总市值、流通市值" },
  { id: "sentiment",name: "情绪因子",   desc: "北向资金、分析师评级" },
];

// 依据组合净值曲线生成模拟基准曲线（同向但更平缓，前端演示用）
const mkBench = (curve, beta = 0.45, wobble = 1.8) =>
  curve.map((v, i) => +(100 + (v - 100) * beta + Math.sin(i / 4) * wobble).toFixed(1));

// 我的策略（模拟）
const STRATEGIES = [
  {
    id: "s1",
    name: "稳健红利低波组合",
    status: "running",            // running=运行中 done=回测完成 draft=草稿
    universe: "沪深300 + 中证500",
    rebalance: "每月调仓",
    benchmark: "中证红利指数",
    updatedAt: "2026-09-21",
    factors: [
      { id: "dividend", name: "股息率", weight: 35 },
      { id: "lowvol",   name: "低波动", weight: 30 },
      { id: "quality",  name: "质量",   weight: 20 },
      { id: "value",    name: "价值",   weight: 15 },
    ],
    metrics: { annual: 14.6, drawdown: -8.3, sharpe: 1.62, winRate: 63.5 },
    curve: [100,100.8,101.5,100.9,102.3,103.6,103.1,104.8,106.2,105.6,107.4,109.1,108.5,110.3,112.0,111.4,113.2,114.9,116.1,115.4,117.2,119.0,120.6,119.8,121.5,123.2,122.6,124.4,126.1,127.5],
    holdings: [
      { code: "600036", name: "招商银行", score: 92.4, weight: 6.8, change: 1.24 },
      { code: "601088", name: "中国神华", score: 90.1, weight: 6.2, change: 0.86 },
      { code: "600941", name: "中国移动", score: 88.7, weight: 5.9, change: 0.42 },
      { code: "601288", name: "农业银行", score: 87.5, weight: 5.5, change: -0.31 },
      { code: "600028", name: "中国石化", score: 85.9, weight: 5.1, change: 0.65 },
    ],
  },
  {
    id: "s2",
    name: "成长质量双驱动",
    status: "running",
    universe: "中证800",
    rebalance: "每两周调仓",
    benchmark: "中证800成长",
    updatedAt: "2026-09-22",
    factors: [
      { id: "growth",  name: "成长", weight: 40 },
      { id: "quality", name: "质量", weight: 35 },
      { id: "momentum",name: "动量", weight: 25 },
    ],
    metrics: { annual: 21.3, drawdown: -14.7, sharpe: 1.38, winRate: 58.2 },
    curve: [100,101.2,100.4,102.6,103.8,102.9,105.1,107.3,106.2,108.8,111.0,109.7,112.4,115.1,113.8,116.6,119.3,118.0,121.2,124.0,122.6,125.8,128.9,127.4,130.8,133.6,132.1,135.4,138.2,140.6],
    holdings: [
      { code: "300750", name: "宁德时代", score: 94.2, weight: 7.4, change: 2.13 },
      { code: "002594", name: "比亚迪",   score: 91.8, weight: 6.9, change: 1.57 },
      { code: "600519", name: "贵州茅台", score: 89.5, weight: 6.1, change: -0.44 },
      { code: "000333", name: "美的集团", score: 88.2, weight: 5.8, change: 0.91 },
      { code: "300059", name: "东方财富", score: 86.6, weight: 5.3, change: 1.78 },
    ],
  },
  {
    id: "s3",
    name: "小盘动量增强",
    status: "done",
    universe: "中证1000",
    rebalance: "每周调仓",
    benchmark: "中证1000指数",
    updatedAt: "2026-09-19",
    factors: [
      { id: "momentum",  name: "动量",   weight: 45 },
      { id: "size",      name: "小市值", weight: 25 },
      { id: "liquidity", name: "流动性", weight: 20 },
      { id: "sentiment", name: "情绪",   weight: 10 },
    ],
    metrics: { annual: 26.8, drawdown: -19.4, sharpe: 1.21, winRate: 55.6 },
    curve: [100,99.2,101.5,103.1,101.2,104.4,106.8,104.2,107.9,110.5,108.1,112.3,115.6,112.9,117.4,120.8,117.6,122.5,126.3,123.1,128.4,132.2,129.0,134.6,138.9,135.2,141.0,145.3,141.8,147.2],
    holdings: [
      { code: "301269", name: "华大九天", score: 93.6, weight: 5.2, change: 3.42 },
      { code: "688256", name: "寒武纪",   score: 92.1, weight: 5.0, change: 4.18 },
      { code: "300308", name: "中际旭创", score: 90.4, weight: 4.8, change: 2.65 },
      { code: "688041", name: "海光信息", score: 89.3, weight: 4.6, change: 1.93 },
      { code: "300502", name: "新易盛",   score: 88.0, weight: 4.4, change: 2.87 },
    ],
  },
  {
    id: "s4",
    name: "基本面价值精选（草稿）",
    status: "draft",
    universe: "全市场（剔除ST）",
    rebalance: "每季度调仓",
    benchmark: "沪深300指数",
    updatedAt: "2026-09-15",
    factors: [
      { id: "value",   name: "价值", weight: 50 },
      { id: "quality", name: "质量", weight: 30 },
      { id: "dividend",name: "股息率", weight: 20 },
    ],
    metrics: { annual: null, drawdown: null, sharpe: null, winRate: null },
    curve: [100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100],
    holdings: [],
  },
];

// 为每个策略补一条基准曲线（演示数据）
STRATEGIES.forEach(s => { s.benchCurve = mkBench(s.curve); });

// 回测参数（演示口径，实际以后端回测引擎为准）；hint 为悬停说明
const BT_PARAMS = [
  { label: "回测区间", value: "2023-09 ~ 2026-09", hint: "历史模拟回测区间，共 3 年" },
  { label: "Top K", value: "50 只", hint: "每次调仓选取综合因子得分最高的 K 只股票" },
  { label: "手续费率", value: "双边 0.1%", hint: "买卖均按成交额收取，含佣金与印花税" },
];

// 演示用股票池（生成当前持仓）
const DEMO_STOCK_POOL = [
  { code: "600519", name: "贵州茅台" },
  { code: "300750", name: "宁德时代" },
  { code: "600036", name: "招商银行" },
  { code: "601088", name: "中国神华" },
  { code: "600941", name: "中国移动" },
  { code: "000333", name: "美的集团" },
  { code: "601318", name: "中国平安" },
  { code: "600276", name: "恒瑞医药" },
  { code: "688041", name: "海光信息" },
  { code: "300308", name: "中际旭创" },
  { code: "002594", name: "比亚迪" },
  { code: "601899", name: "紫金矿业" },
  { code: "600900", name: "长江电力" },
  { code: "000858", name: "五粮液" },
  { code: "601166", name: "兴业银行" },
  { code: "300059", name: "东方财富" },
];

// 对话推荐提示词
const CHAT_SUGGESTIONS = [
  "构建一个「低波动 + 高股息」防御型策略",
  "回测动量因子近三年的表现",
  "在沪深300里筛选 ROE > 15% 且估值分位低于 30% 的股票",
  "帮我分析一下当前白酒板块的因子暴露",
];

// 个人资料
const PROFILE = {
  name: "陈研究员",
  org: "XX证券 · 金融工程组",
  plan: "专业版会员",
  registerDate: "2025-11-02",
  lastLogin: "2026-09-23 09:12",
  radar: [
    { name: "价值",   value: 78 },
    { name: "成长",   value: 65 },
    { name: "动量",   value: 82 },
    { name: "质量",   value: 70 },
    { name: "低波动", value: 58 },
  ],
  settings: [
    { key: "notify",   icon: "bell",     title: "调仓与信号通知",   desc: "策略触发买卖信号时推送提醒", on: true },
    { key: "report",   icon: "file",     title: "每日策略日报",     desc: "每个交易日收盘后生成持仓分析", on: true },
    { key: "apikey",   icon: "key",      title: "API 密钥管理",     desc: "用于接入行情与回测数据服务", on: null, value: "已配置 2 个" },
    { key: "datasrc",  icon: "database", title: "数据源配置",       desc: "行情数据 / 财务数据 / 另类数据", on: null, value: "聚宽 + Wind" },
    { key: "risk",     icon: "shield",   title: "风险偏好",         desc: "影响智能体推荐策略的风格",   on: null, value: "稳健型" },
  ],
};

// 构建类请求：按用户描述的风格生成「策略框架 + 回测报告」一体化回复（不含个股明细）
const STRATEGY_STYLES = [
  { keys: ["小盘", "动量"], name: "小盘动量增强", tag: "进攻型",
    universe: "中证1000", rebalance: "每周调仓", benchName: "中证1000指数",
    factors: [["动量", 45], ["小市值", 25], ["流动性", 20], ["情绪", 10]] },
  { keys: ["低波", "红利", "股息", "防御"], name: "稳健红利低波", tag: "防御型",
    universe: "沪深300 + 中证500", rebalance: "每月调仓", benchName: "中证红利指数",
    factors: [["股息率", 35], ["低波动", 30], ["质量", 20], ["价值", 15]] },
  { keys: ["成长", "质量"], name: "成长质量双驱动", tag: "均衡型",
    universe: "中证800", rebalance: "每两周调仓", benchName: "中证800成长",
    factors: [["成长", 40], ["质量", 35], ["动量", 25]] },
  { keys: ["价值", "低估"], name: "基本面价值精选", tag: "防御型",
    universe: "全市场（剔除ST）", rebalance: "每季度调仓", benchName: "沪深300指数",
    factors: [["价值", 50], ["质量", 30], ["股息率", 20]] },
];

function buildStrategyReply(text) {
  const st = STRATEGY_STYLES.find(s => s.keys.some(k => text.includes(k))) || {
    name: "多因子均衡组合", tag: "均衡型",
    universe: "沪深300 + 中证500", rebalance: "每月调仓", benchName: "沪深300指数",
    factors: [["价值", 30], ["质量", 30], ["动量", 25], ["低波动", 15]],
  };
  const curve = Array.from({ length: 30 }, (_, i) =>
    +(100 + i * (0.5 + Math.random() * 0.5) + Math.sin(i / 3) * 1.5 + (Math.random() - 0.45) * 2.2).toFixed(1));
  const total = curve[curve.length - 1] / 100 - 1;
  const rawMetrics = {
    annual: +((Math.pow(1 + total, 1 / 3) - 1) * 100).toFixed(1),
    drawdown: maxDrawdownPct(curve),
    sharpe: +(0.7 + Math.random() * 0.9).toFixed(2),
    winRate: +(52 + Math.random() * 11).toFixed(1),
  };
  const mFmt = v => (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  return {
    text: `好的，已按你的描述构建「${st.name}」策略：因子配置如下，回测报告也一并生成好了（收益已扣除手续费）。`,
    card: {
      type: "report",
      title: `${st.name} · 回测报告`,
      tag: st.tag,
      factors: st.factors.map(([name, weight]) => ({ name, weight })),
      curve,
      benchCurve: mkBench(curve),
      benchName: st.benchName,
      metrics: [
        { label: "年化收益", value: mFmt(rawMetrics.annual), cls: rawMetrics.annual > 0 ? "up" : "down" },
        { label: "最大回撤", value: rawMetrics.drawdown.toFixed(1) + "%", cls: "down" },
        { label: "夏普比率", value: rawMetrics.sharpe.toFixed(2), cls: "" },
        { label: "胜率", value: rawMetrics.winRate.toFixed(1) + "%", cls: "" },
      ],
      rawMetrics,
      universe: st.universe,
      rebalance: st.rebalance,
      note: `股票池与调仓：${st.universe}，${st.rebalance}，单票权重上限 8%。可保存后在策略详情中继续调整权重，保存时会按新配置自动重新回测。`,
    },
  };
}

// 智能体模拟回复规则（关键词匹配）；构建类请求由 buildStrategyReply 兜底
const AGENT_REPLIES = [
  {
    match: ["回测", "表现", "历史"],
    text: "已对你选中的因子组合完成近三年回测（2023-09 至 2026-09），关键绩效指标如下：",
    card: {
      type: "backtest",
      title: "动量因子组合 · 回测报告",
      tag: "近三年",
      curve: STRATEGIES[1].curve,
      benchCurve: STRATEGIES[1].benchCurve,
      benchName: "中证800成长",
      metrics: [
        { label: "年化收益", value: "+21.3%", cls: "up" },
        { label: "最大回撤", value: "-14.7%", cls: "down" },
        { label: "夏普比率", value: "1.38", cls: "" },
        { label: "胜率", value: "58.2%", cls: "" },
      ],
      note: "回测期内组合跑赢中证800成长基准 9.6 个百分点，信息比率 1.12；回撤主要出现在 2024 年 1 月的小盘流动性冲击阶段。",
    },
  },
  {
    match: ["筛选", "ROE", "估值", "白酒"],
    text: "筛选完成。我在沪深300成分股中按「ROE(TTM) > 15% 且 PE 历史分位 < 30%」进行交叉筛选，并对结果按综合因子得分排序：",
    card: {
      type: "stocks",
      title: "沪深300 · 高ROE低估值筛选结果",
      tag: "共 12 只 · 展示前 5",
      stocks: [
        { code: "600519", name: "贵州茅台", score: 91.2, weight: null },
        { code: "000858", name: "五粮液",   score: 88.4, weight: null },
        { code: "601166", name: "兴业银行", score: 86.9, weight: null },
        { code: "601318", name: "中国平安", score: 85.7, weight: null },
        { code: "600276", name: "恒瑞医药", score: 84.3, weight: null },
      ],
      note: "该筛选未考虑行业集中度，如需控制行业暴露可以让我加入行业中性化约束。",
    },
  },
];
