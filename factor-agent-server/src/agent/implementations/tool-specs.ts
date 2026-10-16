/* ==========================================================
   工具定义（OpenAI function 格式）：LangGraph 智能体绑定的 4 个工具 schema。

   本文件只放"声明"——工具名/描述/参数约束是 GLM 每轮请求都会看到的协议内容，
   执行逻辑在 langgraph-agent.service.ts 的 tools 节点（按 call.name 分发）。
   修改参数或描述只动本文件；表/字段白名单校验在 D 层（factor-schema + 取数服务），
   这里写的约束是给模型看的行为指引，服务端校验不依赖本文件。
   ========================================================== */

/** 工具 1：列出全部可用数据表（tables.md 目录）。表目录通常已注入 system prompt，本工具仅作兜底 */
export const LIST_FACTOR_TABLES_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_factor_tables',
    description:
      '列出因子数据库中全部可用数据表（表名/中文名/说明/唯一键）。' +
      '系统提示通常已附完整表目录，此时无需调用本工具；仅当提示中没有表目录、或需确认目录有更新时调用。' +
      '禁止凭记忆编造表名。',
    parameters: { type: 'object', properties: {} },
  },
};

/** 工具 2：按表名列表（可多表）返回字段明细，表名必须来自工具 1 的返回 */
export const LIST_FACTOR_FIELDS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_factor_fields',
    description:
      '列出指定数据表的全部因子字段（字段名/中文名/类型/可空/说明），一次可查多张表。' +
      '表名必须来自系统提示中的表目录（或 list_factor_tables 的返回）；选出要用的因子后调用 read_factor_data 读数。',
    parameters: {
      type: 'object',
      properties: {
        tables: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '表名列表，可一次查多张表',
        },
      },
      required: ['tables'],
    },
  },
};

/** 工具 3：按 表/因子字段集合/交易日/证券代码 单点读数（数据问答用，回测不需要先抽样） */
export const READ_FACTOR_DATA_SPEC = {
  type: 'function' as const,
  function: {
    name: 'read_factor_data',
    description:
      '按 表/因子字段集合/交易日/证券代码 读取数据。' +
      'table 必须来自系统提示中的表目录，fields 必须来自 list_factor_fields 的返回，' +
      'date 为纯数字交易日（如 20210506），security 为证券或指数代码（如 000002.XSHE / 000001.XSHG 上证指数）；' +
      '股票因子表按全码匹配，指数/主表自动按交易代码+交易市场匹配，日期对无交易日列的静态表自动忽略。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '数据表名' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '因子字段名列表',
        },
        date: { type: 'string', description: '交易日，纯数字 YYYYMMDD，如 20210506' },
        security: { type: 'string', description: '证券代码，如 000002.XSHE' },
      },
      required: ['table', 'fields', 'date', 'security'],
    },
  },
};

/** 工具 4：策略回测（日频事件内核，StrategySpec v1）。
 *  rebalanceIntervalDays 必填无默认值，缺了服务端会返回澄清指引；
 *  sortFactors 缺省时引擎兜底默认 20 日动量（值大优），确认弹窗会如实展示。 */
export const RUN_STRATEGY_BACKTEST_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_strategy_backtest',
    description:
      '运行策略回测并生成净值卡片（日频事件内核）：T 日收盘按过滤+排序选出目标持仓，T+1 开盘或收盘价执行，' +
      '支持资金账户（初始资金/整手/单边费率双边计提）、T+1、停牌顺延、卖出规则（止盈止损/持有天数/排名跌出等），' +
      '输出年化收益、最大回撤、夏普、胜率、年化换手、净值/基准曲线、交易明细与月度归因。' +
      '因子一律按 table.field 从数据表读取（表名必须来自系统提示中的表目录，字段名必须来自 list_factor_fields 的返回），' +
      '回测无需先用 read_factor_data 抽样验证数据。' +
      '过滤与排序是两个独立参数：同一因子既过滤又排序时须在 entryFilters 与 sortFactors 各传一次。' +
      'sortFactors 为空时引擎自动用默认排序因子（20 日动量 REVS20，值大优），弹窗会向用户展示。' +
      'rebalanceIntervalDays 为必填参数且无默认值，用户未指明调仓间隔时必须先向用户询问，禁止自行假设；' +
      'startDate/endDate 用户说过的区间照传，相对时间表达（如"最近两年""今年"）按系统提示中的今天日期换算为纯数字区间，' +
      '用户完全没提时填合理区间（如近三年）即可，不要反问——所有参数会在执行前经用户确认，用户可当场调整。',
    parameters: {
      type: 'object',
      properties: {
        securityIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            '股票池：证券代码数组（如 ["000002.XSHE"]，来自前置筛选或用户指定）。缺省/空 = 全市场。' +
            '禁止在对话中手拼超长清单；需要行业/主题股票池时先用筛选手段得到代码清单',
        },
        startDate: {
          type: 'string',
          description: '回测开始日，纯数字 YYYYMMDD。用户说过的时间照传，相对时间按系统提示的今天日期换算；执行前会经用户确认，可被当场修改',
        },
        endDate: {
          type: 'string',
          description: '回测结束日，纯数字 YYYYMMDD。约束同 startDate：用户说过照传、相对时间按今天日期换算，执行前会经用户确认',
        },
        rebalanceIntervalDays: {
          type: 'integer',
          description: '调仓间隔（必填，无默认值）：每隔多少个交易日调仓一次，如 5≈每周、10≈每两周、21≈每月、63≈每季',
        },
        positionDeviatePct: {
          type: 'number',
          description:
            '仓位带宽，两种模式语义不同：触发模式（rebalanceIntervalDays=0）必传，5~50 的整数，持仓市值偏离目标总仓位 ±该值时再平衡；' +
            '调仓模式（>0）可选，为择时拉回阈值 %（默认 1，0~100），用户表达"偏离目标仓位超 X% 就拉回"时传入',
        },
        minPositionPct: {
          type: 'number',
          description:
            '最小建仓仓位 %，默认 1（0.1~每只目标仓位）：单只目标市值低于权益×该比例时不建仓、顺延下一候选。用户说"每只至少建 X% 仓"时传入',
        },
        initialCapital: { type: 'number', description: '初始资金，默认 1000000（100 万）。用户提到资金规模时按用户说的传' },
        feeRate: {
          type: 'number',
          description: '单边交易费率（小数，0.0003 = 万三，买卖双边各计提一次）。默认 0.0003；用户明确说不计费用时传 0',
        },
        executionTiming: {
          type: 'integer',
          enum: [0, 1],
          description: '成交时点：0=开盘价成交（默认）/ 1=收盘价成交',
        },
        maxPositions: {
          type: 'integer',
          description: '最大持仓数，默认 10，上限 100。用户提到 topN/持仓 N 只/选 N 只时必须按用户说的数值传入（top5 → 5），禁止擅自换成默认值',
        },
        idealPositionPct: {
          type: 'number',
          description: '每只目标仓位 %，缺省 = 100/maxPositions（满仓等权）。用户说"每只 5% 仓位"之类时传入',
        },
        entryFilters: {
          type: 'array',
          maxItems: 10,
          description: '过滤因子：全部满足才入选（不满足即剔除，因子值缺失视为不满足）',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              op: { type: 'string', enum: ['>', '<'], description: '比较符：大于 / 小于' },
              value: { type: 'number', description: '阈值' },
            },
            required: ['table', 'field', 'op', 'value'],
          },
        },
        sortFactors: {
          type: 'array',
          maxItems: 10,
          description:
            '排序因子：各因子截面分位数标准化（0~100）后加权合成综合分，按综合分降序取前 maxPositions。' +
            '缺省 = 引擎自动用默认排序因子（20 日动量 REVS20，值大优）。weight 全省略 = 等权 1/N；' +
            '需要加权时必须给全部因子传 weight（按总和归一化），不支持只传部分',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              direction: { type: 'integer', enum: [1, -1], description: '排序方向：1=值大优（默认，如动量）/ -1=值小优（如低估值）' },
              weight: { type: 'number', description: '权重；全部因子都传才生效（缺省等权 1/N）' },
            },
            required: ['table', 'field', 'direction'],
          },
        },
        sellRules: {
          type: 'array',
          maxItems: 10,
          description:
            '卖出规则：持仓期每日收盘后检查，命中次日执行（全仓卖出）。' +
            'rank_out 在调仓日按综合分排名生效（跌出前 bottomN 名即卖）',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['field', 'stop_profit', 'stop_loss', 'max_drawdown_from_entry', 'max_hold_days', 'rank_out'],
                description:
                  'field=字段条件触发（如跌破均线标记）；stop_profit=止盈%；stop_loss=止损%；' +
                  'max_drawdown_from_entry=买入后自峰值回撤%；max_hold_days=持有满 N 个交易日；rank_out=调仓日排名跌出前 N',
              },
              table: { type: 'string', description: 'kind=field 时必填：数据表名' },
              field: { type: 'string', description: 'kind=field 时必填：字段名' },
              op: { type: 'string', enum: ['>', '<'], description: 'kind=field 时必填：比较符' },
              value: { type: 'number', description: 'kind=field 时必填：阈值' },
              pct: { type: 'number', description: 'stop_profit/stop_loss/max_drawdown_from_entry 时必填：百分比数值（10 = 10%）' },
              days: { type: 'integer', description: 'max_hold_days 时必填：持有交易日数' },
              bottomN: { type: 'integer', description: 'rank_out 时必填：排名阈值' },
            },
            required: ['kind'],
          },
        },
        benchmark: {
          type: 'string',
          enum: ['hs300', 'csi500', 'sse'],
          description: '业绩基准：hs300 沪深300（默认）/ csi500 中证500 / sse 上证指数',
        },
        timingOverlay: {
          type: 'object',
          description:
            '大盘择时叠加（可选）：字段条件逐日投票的状态机决定策略总仓位——牛市满仓、熊市保留 bearPositionPct。' +
            '仅当用户明确表达总仓位控制意图（如"跌破某点位就空仓""放量才满仓"）时传入；' +
            'rules 的 table/field 必须来自表目录与 list_factor_fields（当前可用 mkt_idxd 的 CLOSE_INDEX/CHG_PCT/TURNOVER_VALUE 等）；' +
            'index 缺省 sse（上证）、bearPositionPct 缺省 0（空仓）、enterVotes/exitVotes 缺省 -1（需全部条件），缺省值须在提案中注明；' +
            '字典暂无均线/金叉类字段，用户提出此类条件时如实告知暂不支持，引导改用点位/涨跌幅/量能条件。' +
            '结构：{index:"sse"|"hs300"|"csi500", rules:[{table,field,op:">"|"<"|"bw", value 或 low/high}](1~3 条), ' +
            'enterVotes:-1|数字, exitVotes:-1|数字, bearPositionPct:0~100}',
        },
      },
      required: ['startDate', 'endDate', 'rebalanceIntervalDays'],
    },
  },
};

/** 全部工具 schema：bindTools 一次绑定，顺序即 prompt 里的工具编号 */
export const AGENT_TOOL_SPECS = [
  LIST_FACTOR_TABLES_SPEC,
  LIST_FACTOR_FIELDS_SPEC,
  READ_FACTOR_DATA_SPEC,
  RUN_STRATEGY_BACKTEST_SPEC,
] as const;

/* ----- 工具入参形态（LLM 传入，字段均为未知形态，服务端归一化校验） ----- */

export interface ListFactorFieldsArgs {
  tables?: unknown;
}

export interface ReadFactorDataArgs {
  table?: unknown;
  fields?: unknown;
  date?: unknown;
  security?: unknown;
}
