/* ==========================================================
   工具定义（OpenAI function 格式）：LangGraph 智能体绑定的 12 个工具 schema。

   描述规范（token 减负，prompt 分支定稿）：
   1. 工具描述只写一句话——干什么 + 产出什么（至多带一个触发时机）；
   2. 用法/默认值/约束/禁传条件一律写进对应参数的 description；
   3. 跨参数重复的约束只写在"做动作的那个参数"上（如触发模式三条件集中在 rebalanceIntervalDays）。

   本文件只放"声明"——执行逻辑在 langgraph-agent.service.ts 的 tools 节点（按 call.name 分发）。
   表/字段白名单校验在 D 层（factor-schema + 取数服务），这里写的约束是给模型看的行为指引，
   服务端校验不依赖本文件。
   ========================================================== */

import { describeFunctions } from '../../core/weight-functions';

/** 工具 1：列出全部可用数据表（tables.md 目录）。表目录通常已注入 system prompt，本工具仅作兜底 */
export const LIST_FACTOR_TABLES_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_factor_tables',
    description: '列出因子库全部可用数据表（表名/中文名/说明/唯一键）；系统提示已附表目录时无需调用。',
    parameters: { type: 'object', properties: {} },
  },
};

/** 工具 2：按表名列表（可多表）返回字段明细，表名必须来自工具 1 的返回 */
export const LIST_FACTOR_FIELDS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_factor_fields',
    description: '列出指定数据表的全部因子字段（字段名/中文名/类型/说明），一次可查多张表。',
    parameters: {
      type: 'object',
      properties: {
        tables: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '表名列表，来自系统提示中的表目录或 list_factor_tables 的返回',
        },
      },
      required: ['tables'],
    },
  },
};

/** 工具 3：单点读数（常规行读 + 行业域表去重读/值发现，ADR-0011 链路复用不新增工具） */
export const READ_FACTOR_DATA_SPEC = {
  type: 'function' as const,
  function: {
    name: 'read_factor_data',
    description: '按 表/因子字段/交易日/证券 单点读数；或对行业域表按字段去重取值（值发现），筛股票池前核实字段可用值。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '常规行读必填：因子字段名列表，来自 list_factor_fields 的返回',
        },
        date: { type: 'string', description: '常规行读必填：交易日，纯数字 YYYYMMDD（如 20210506）' },
        security: {
          type: 'string',
          description: '常规行读必填：证券代码（000002.XSHE 形态；指数如 000001.XSHG 上证指数）。股票因子表按全码匹配，指数/主表按交易代码+市场自动匹配',
        },
        distinct: {
          type: 'string',
          description: '值发现读法：与 fields/date/security 互斥，只传 table+distinct（可选 keyword），返回该字段去重取值清单（如 distinct="l2_name" 查 sw_member 全部二级行业名）；仅行业域表（sw_classify/sw_member）支持',
        },
        keyword: { type: 'string', description: '去重读收窄：只返回包含该关键词的取值（如 keyword="酒"）' },
      },
      required: ['table'],
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
      '运行多因子选股策略回测，产出回测卡：净值/基准曲线、年化/回撤/夏普/胜率/换手、逐笔交易与本次采用的参数口径。',
    parameters: {
      type: 'object',
      properties: {
        securityIds: {
          type: 'array',
          items: { type: 'string' },
          description: '股票池：用户点名或前置筛选的少量证券代码（如 ["000002.XSHE"]）。缺省/空 = 全市场；行业/指数成分用 poolId，禁止手工拼成分清单；触发模式（rebalanceIntervalDays=0）必传',
        },
        poolId: {
          type: 'string',
          description: '股票池句柄：screen_stock_pool 返回的池句柄，仅池内选股；成员按调仓日时点归属解析（期内调样自动跟随），与 securityIds 取交集；仅本会话有效；触发模式不支持',
        },
        keepFullyInvested: {
          type: 'boolean',
          description: '仓位维持，默认不传=false（卖出现金保留至下一调仓日）。仅用户明确要求"始终保持满仓"时传 true，未要求禁止传',
        },
        limitUpDownSkip: {
          type: 'boolean',
          description: '涨跌停判定，默认不传=true（触及官方涨跌停价不成交；档位：主板±10%/ST±5%/创业板科创板±20%/北交所±30%）。仅跨平台对照且用户明确要求时传 false，未要求禁止传',
        },
        startDate: {
          type: 'string',
          description: '开始日，纯数字 YYYYMMDD。用户说过照传；相对表达按系统提示的今天日期换算；完全没提就填合理区间（如近三年），不要反问——执行前有确认门，用户可当场改',
        },
        endDate: {
          type: 'string',
          description: '结束日，纯数字 YYYYMMDD。约定同 startDate',
        },
        rebalanceIntervalDays: {
          type: 'integer',
          description: '调仓间隔（必填，无默认）：间隔交易日数，5≈每周/10≈每两周/21≈每月/63≈每季；用户未指明必须先问，禁止自行假设。=0 为触发模式（"满足条件就买"）：须同时传 positionDeviatePct 且 securityIds 不能为空；此模式 sellRules 仅支持止盈/止损/回撤/最大持有天数',
        },
        positionDeviatePct: {
          type: 'number',
          description: '触发模式（rebalanceIntervalDays=0）必传：持仓市值偏离目标总仓位 ±该值（5~50 整数）时再平衡；调仓模式可选：择时拉回阈值 %（默认 1，0~100），用户说"偏离超 X% 就拉回"时传',
        },
        minPositionPct: {
          type: 'number',
          description: '最小建仓仓位 %，默认 1（0.1~单只目标仓位）：单只目标市值低于权益×该比例时顺延不建仓；用户说"每只至少建 X%"时传',
        },
        initialCapital: { type: 'number', description: '初始资金，默认 1000000；用户提到资金规模按用户说的传' },
        feeRate: {
          type: 'number',
          description: '单边费率小数（0.0003=万三，买卖双边各计提），默认 0.0003；用户明确说不计费用传 0',
        },
        slippageRate: {
          type: 'number',
          description: '单边滑点小数（0.001=10bp，默认 0）：买入价上滑、卖出价下滑，不越过涨跌停价；仅用户明确要求考虑滑点时传',
        },
        executionTiming: {
          type: 'integer',
          enum: [0, 1, 2],
          description: '成交时点：0=次日开盘价（默认，保守口径）/ 1=次日收盘价 / 2=信号日当日收盘价（尾盘单，跨平台当日撮合对照用）',
        },
        maxPositions: {
          type: 'integer',
          description: '最大持仓数，默认 10、上限 100，提案中注明"默认"；用户说 topN/N 只时按用户数值传（top5→5），禁止擅自换成默认值',
        },
        idealPositionPct: {
          type: 'number',
          description: '每只目标仓位 %，缺省 = 100/maxPositions（满仓等权）；用户说"每只 5% 仓位"时传',
        },
        entryFilters: {
          type: 'array',
          maxItems: 10,
          description:
            '过滤因子：全部满足才入选（个股字段缺失视为不满足）；阈值直接按语义定，无需先用 read_factor_data 验证数据。' +
            '同一因子既要过滤又要排序时，须在 entryFilters 与 sortFactors 各传一次。' +
            '大盘条件（table=mkt_idxd）是"股票池开关"，与 timingOverlay（总仓位择时）互补：' +
            '"大盘在 XX 上方买 A 类"用本参数，"大盘不好就减仓"用 timingOverlay',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              op: { type: 'string', enum: ['>', '<', 'eq', 'bw'], description: '比较符：大于 / 小于 / 等于 / 区间（bw 时 value 传 [下限, 上限]）' },
              value: {
                description: '阈值；op=bw 传 [下限, 上限] 闭区间。须落在字段真实值域内，拿不准先 read_factor_data 抽样看值域，禁止拍脑袋填大数',
                type: ['number', 'array'],
                items: { type: 'number' },
              },
              indexCode: {
                type: 'string',
                enum: ['hs300', 'csi500', 'sse'],
                description: '仅大盘条件（table=mkt_idxd）可传：挂靠指数，缺省 sse',
              },
            },
            required: ['table', 'field', 'op', 'value'],
          },
        },
        sortFactors: {
          type: 'array',
          maxItems: 10,
          description:
            '排序因子：截面分位数标准化（0~100）加权合成综合分，降序取前 maxPositions。' +
            '缺省 = 默认排序因子（20 日动量 REVS20，值大优），提案中向用户注明；自定义因子权重用 weightFn，不要在此传权重',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              direction: { type: 'integer', enum: [1, -1], description: '方向：1=值大优（默认，如动量）/ -1=值小优（如低估值）' },
            },
            required: ['table', 'field', 'direction'],
          },
        },
        weightFn: {
          type: 'object',
          description:
            '权重函数（可选，缺省等权）：每次调仓求各排序因子权重，因子截面由引擎供给，只传函数名与旋钮：\n' +
            describeFunctions('factor-weight'),
          properties: {
            name: { type: 'string', description: '函数名，从上方名录中选择' },
            params: { type: 'object', description: '该函数的旋钮参数，结构见名录' },
          },
          required: ['name'],
        },
        positionFn: {
          type: 'object',
          description:
            '仓位函数（可选，缺省等权）：每次调仓输出各候选目标买入金额（整手/现金由校验器修正）。' +
            '"指数均线定总仓位"属大盘择时，用 timingOverlay 不要用本参数：\n' +
            describeFunctions('position'),
          properties: {
            name: { type: 'string', description: '函数名，从上方名录中选择' },
            params: { type: 'object', description: '该函数的旋钮参数，结构见名录' },
          },
          required: ['name'],
        },
        sellRules: {
          type: 'array',
          maxItems: 10,
          description: '卖出规则：持仓期每日收盘检查、命中次日全仓卖出；rank_out 仅调仓日按综合分排名生效',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['field', 'stop_profit', 'stop_loss', 'max_drawdown_from_entry', 'max_hold_days', 'rank_out'],
                description: 'field=字段条件 / stop_profit=止盈% / stop_loss=止损% / max_drawdown_from_entry=买入后自峰值回撤% / max_hold_days=持有满 N 日 / rank_out=调仓日跌出前 N',
              },
              table: { type: 'string', description: 'kind=field 必填：数据表名' },
              field: { type: 'string', description: 'kind=field 必填：字段名' },
              op: { type: 'string', enum: ['>', '<'], description: 'kind=field 必填：比较符' },
              value: { type: 'number', description: 'kind=field 必填：阈值' },
              pct: { type: 'number', description: '止盈/止损/回撤必填：百分比数值（10 = 10%）' },
              days: { type: 'integer', description: 'max_hold_days 必填：持有交易日数' },
              bottomN: { type: 'integer', description: 'rank_out 必填：排名阈值' },
            },
            required: ['kind'],
          },
        },
        keepRules: {
          type: 'array',
          maxItems: 10,
          description:
            '不卖条件（可选）：命中则继续持有，优先级高于全部卖出规则与调仓换出（跌出排名也不卖）；大盘择时的仓位调整不受其保护。' +
            '结构同 entryFilters 元素（暂不支持指数表字段）；用户说"满足 XX 就不卖""强势股别调出"时传',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              op: { type: 'string', enum: ['>', '<', 'eq', 'bw'], description: '比较符；bw 时 value 传 [下限, 上限]' },
              value: {
                description: '阈值；须在字段真实值域内，拿不准先 read_factor_data 抽样',
                type: ['number', 'array'],
                items: { type: 'number' },
              },
            },
            required: ['table', 'field', 'op', 'value'],
          },
        },
        excludeRanges: {
          type: 'array',
          maxItems: 5,
          description: '排除时间段（可选）：段内不交易不调仓，持仓按冻结时点价估值（净值走平）；用户说"剔除股灾""排除 XX 年上半年"时传',
          items: {
            type: 'object',
            properties: {
              start: { type: 'string', description: '开始日，纯数字 YYYYMMDD' },
              end: { type: 'string', description: '结束日，纯数字 YYYYMMDD' },
            },
            required: ['start', 'end'],
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
            '大盘择时（可选）：字段条件逐日投票的状态机控制总仓位——牛市满仓、熊市保留 bearPositionPct。' +
            '仅用户明确表达总仓位控制意图（如"跌破某点位就空仓"）时传。' +
            '结构：{index:"sse"|"hs300"|"csi500", rules:[{table,field,op:">"|"<"|"bw", value 或 low/high}] 1~3 条, enterVotes, exitVotes, bearPositionPct:0~100}。' +
            '缺省：index=sse、bearPositionPct=0（空仓）、enterVotes/exitVotes=-1（需全部条件命中），缺省值提案中注明。' +
            '字段当前可用 mkt_idxd 的 CLOSE_INDEX/CHG_PCT/TURNOVER_VALUE；暂无均线/金叉类字段，用户提出时如实告知并引导改用点位/涨跌幅/量能',
        },
      },
      required: ['startDate', 'endDate', 'rebalanceIntervalDays'],
    },
  },
};

/** 排名分析工具：因子分段有效性评估（果仁「排名分析」对标，个股级 IC 口径） */
const RUN_RANK_ANALYSIS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_rank_analysis',
    description:
      '把股票池按因子值分 N 段逐段对比下期收益，并计算个股级 IC 均值/正概率/IR 与排列单调性，评估排序因子的选股能力；用户问"这个因子有没有效/分段测试/排名 IC"时用。',
    parameters: {
      type: 'object',
      properties: {
        factor: {
          type: 'object',
          description: '分析因子（单个）：结构同 run_strategy_backtest 的 sortFactors 元素',
          properties: {
            table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
            field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
            direction: { type: 'integer', enum: [1, -1], description: '排序方向：1=值大优（默认）/ -1=值小优' },
          },
          required: ['table', 'field', 'direction'],
        },
        securityIds: {
          type: 'array',
          items: { type: 'string' },
          description: '股票池（000001.XSHE 形态）；不传 = 全市场截面有值股票',
        },
        segmentCount: {
          type: 'integer',
          description: '分段数，默认 5（2~10）。用户没说时按默认传并在提案中注明',
        },
        intervalDays: {
          type: 'integer',
          description: '分析间隔（必填，无默认值）：每 N 个交易日取一次截面并调仓段组合，如 5≈每周、21≈每月',
        },
        startDate: { type: 'string', description: '开始日，纯数字 YYYYMMDD；用户说过照传，相对时间按系统提示的今天换算' },
        endDate: { type: 'string', description: '结束日，纯数字 YYYYMMDD；约定同 startDate' },
      },
      required: ['factor', 'intervalDays', 'startDate', 'endDate'],
    },
  },
} as const;

/** 因子相关性工具：2~10 个因子两两截面秩相关矩阵（多因子组合前判断冗余） */
const RUN_FACTOR_CORRELATION_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_factor_correlation',
    description: '一批因子两两计算截面秩相关矩阵（逐采样期取均值），多因子组合前判断冗余；用户怀疑因子重复时用。',
    parameters: {
      type: 'object',
      properties: {
        factors: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          description: '2~10 个因子（结构同 run_strategy_backtest 的 sortFactors 元素）',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名' },
              field: { type: 'string', description: '字段名' },
              direction: { type: 'integer', enum: [1, -1], description: '1=值大优（默认）/ -1=值小优' },
            },
            required: ['table', 'field', 'direction'],
          },
        },
        securityIds: {
          type: 'array',
          items: { type: 'string' },
          description: '股票池（000001.XSHE 形态）；不传 = 全市场截面有值股票',
        },
        intervalDays: {
          type: 'integer',
          description: '采样间隔（必填，无默认值）：每 N 个交易日取一次截面，如 5≈每周、21≈每月',
        },
        startDate: { type: 'string', description: '开始日，纯数字 YYYYMMDD' },
        endDate: { type: 'string', description: '结束日，纯数字 YYYYMMDD' },
      },
      required: ['factors', 'intervalDays', 'startDate', 'endDate'],
    },
  },
} as const;

/** 每日选股工具：不跑回测，按条件输出单个交易日的入选清单（果仁「每日选股」对标，即查即得免确认） */
const RUN_DAILY_SCREEN_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_daily_screen',
    description:
      '按 过滤+排序 输出单个交易日的入选清单（口径与回测信号一致，即查即得、无需确认）；用户问"今天/某个历史日这套条件选出哪些股"时用。',
    parameters: {
      type: 'object',
      properties: {
        entryFilters: {
          type: 'array',
          maxItems: 10,
          description: '过滤条件：结构同 run_strategy_backtest 的 entryFilters（支持大盘条件与 eq/bw）',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名' },
              field: { type: 'string', description: '字段名' },
              op: { type: 'string', enum: ['>', '<', 'eq', 'bw'], description: '比较符；bw 时 value 传 [下限, 上限]' },
              value: {
                description: '阈值；op=bw 时传二元区间数组。须落在字段真实值域内，拿不准先 read_factor_data 抽样看值域',
                type: ['number', 'array'],
                items: { type: 'number' },
              },
              indexCode: { type: 'string', enum: ['hs300', 'csi500', 'sse'], description: '仅大盘条件（table=mkt_idxd）可传，缺省 sse' },
            },
            required: ['table', 'field', 'op', 'value'],
          },
        },
        sortFactors: {
          type: 'array',
          maxItems: 10,
          description: '排序因子：结构同 run_strategy_backtest 的 sortFactors；缺省 = 默认 20 日动量（值大优）',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名' },
              field: { type: 'string', description: '字段名' },
              direction: { type: 'integer', enum: [1, -1], description: '1=值大优（默认）/ -1=值小优' },
            },
            required: ['table', 'field', 'direction'],
          },
        },
        weightFn: {
          type: 'object',
          description: '权重函数（可选，缺省等权）：同 run_strategy_backtest 的 weightFn，名录与旋钮见彼处',
          properties: {
            name: { type: 'string', description: '函数名，从 run_strategy_backtest.weightFn 名录中选择' },
            params: { type: 'object', description: '该函数的旋钮参数，结构见名录' },
          },
          required: ['name'],
        },
        securityIds: {
          type: 'array',
          items: { type: 'string' },
          description: '股票池（000002.XSHE 形态，用户点名少量股票）；缺省 = 全市场',
        },
        poolId: {
          type: 'string',
          description: '股票池句柄：screen_stock_pool 返回，按查询日时点归属收窄选股域，与 securityIds 取交集',
        },
        maxPositions: { type: 'integer', description: '入选只数，默认 10，上限 100' },
        date: { type: 'string', description: '查询日，纯数字 YYYYMMDD；缺省 = 最近交易日（非交易日自动回落前一交易日，回执注明实际查询日）' },
      },
    },
  },
} as const;

/** 股票池筛选（ADR-0006/0011）：多组条件交并 → 池句柄；成员清单不进对话，回测/选股以 poolId 引用 */
export const SCREEN_STOCK_POOL_SPEC = {
  type: 'function' as const,
  function: {
    name: 'screen_stock_pool',
    description:
      '把维度表字段/指数成分/点名清单组合成可复用股票池，返回池句柄 poolId；用户点名少量股票时不用本工具，直接在回测传 securityIds。',
    parameters: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          description: '筛选组数组：组内并集、组间交集（如 [白酒,家电] ∩ 沪深300）',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['field', 'index', 'list'], description: '来源类型' },
              table: { type: 'string', description: 'kind=field 必填：可筛维度表名（来自表目录，首批仅 sw_member）' },
              field: {
                type: 'string',
                description: 'kind=field 必填：维度表字段名（来自 list_factor_fields，粒度由字段承载：l1_name/l2_name/l3_name）',
              },
              values: {
                type: 'array',
                items: { type: 'string' },
                description: 'kind=field 必填：字段取值数组，须先经 read_factor_data 去重读核实、精确匹配（如 l2_name 的取值是"白酒Ⅱ"而非"白酒"）',
              },
              codes: {
                type: 'array',
                items: { type: 'string' },
                description: 'kind=index 必填：指数代码，常用 000300.SH（沪深300）/ 000905.SH（中证500）/ 000016.SH（上证50）',
              },
              ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'kind=list 必填：证券代码数组（000002.XSHE 形态）',
              },
            },
            required: ['kind'],
          },
        },
      },
      required: ['groups'],
    },
  },
};

/** 长期记忆三操作（ADR-0007）：新增/更新/删除一条用户记忆 */
export const SAVE_MEMORY_SPEC = {
  type: 'function' as const,
  function: {
    name: 'save_memory',
    description: '把用户的稳定偏好、研究结论等值得跨会话记住的事实写入本地记忆库，下次对话自动可见。',
    parameters: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['add', 'update', 'delete'],
          description: '操作：add=新增（用户说"记住：XX"或陈述稳定偏好/结论）/ update=引用既有 slug 覆盖（偏好变了，禁止新增重复条目）/ delete=删除（用户说"忘掉 XX"）',
        },
        slug: {
          type: 'string',
          description: '条目标识（小写英文短横线，如 prefer-momentum）。add 必填（新起一个不与记忆块重复的）；update/delete 必填且必须来自记忆块行首方括号内的既有 slug',
        },
        title: { type: 'string', description: '条目标题（一句话概括，中文）。add/update 必填' },
        content: { type: 'string', description: '条目内容（一到两句事实，具体可执行，不写空话）。add/update 必填' },
      },
      required: ['op'],
    },
  },
};

/** 归因分析工具：对指定回测（card_N）做个股/规则/亏损侧归因聚合 + GLM 解读（ADR-0010 配套） */
const RUN_ATTRIBUTION_ANALYSIS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_attribution_analysis',
    description:
      '对指定回测做归因聚合（个股贡献/卖出规则贡献/亏损行为：回撤窗/买错卖晚卖早踏空/尾部集中度）并生成解读；用户要求"归因分析/为什么赚为什么亏"时用。',
    parameters: {
      type: 'object',
      properties: {
        card: { type: 'string', description: '卡片编号，原样照抄回执或 list_backtest_runs 清单里的值（如 card_2）' },
      },
      required: ['card'],
    },
  },
} as const;

/** 会话回测存档清单：编号/日期/标题索引（ADR-0010 F7）——模型据此跨轮回看，
 *  目标确认后用 get_backtest_run 调出展示；只给索引级摘要，完整卡片绕过 LLM（只信卡片） */
const LIST_BACKTEST_RUNS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_backtest_runs',
    description: '查询本会话历史回测存档清单（卡片编号/日期/标题）；仅用户要求列出/回看历史回测时调用，目标确认后用 get_backtest_run 调出展示。',
    parameters: { type: 'object', properties: {} },
  },
} as const;

/** 调取历史回测：按卡片编号取存档，完整卡片直达前端（摘要给模型） */
const GET_BACKTEST_RUN_SPEC = {
  type: 'function' as const,
  function: {
    name: 'get_backtest_run',
    description: '按卡片编号调取本会话某次回测的完整卡片（净值/交易/持仓）在对话中展示。',
    parameters: {
      type: 'object',
      properties: {
        card: { type: 'string', description: '卡片编号，原样照抄回执或 list_backtest_runs 清单里的值（如 card_2）' },
      },
      required: ['card'],
    },
  },
} as const;

export const AGENT_TOOL_SPECS = [
  LIST_FACTOR_TABLES_SPEC,
  LIST_FACTOR_FIELDS_SPEC,
  READ_FACTOR_DATA_SPEC,
  RUN_STRATEGY_BACKTEST_SPEC,
  RUN_RANK_ANALYSIS_SPEC,
  RUN_FACTOR_CORRELATION_SPEC,
  RUN_DAILY_SCREEN_SPEC,
  SCREEN_STOCK_POOL_SPEC,
  LIST_BACKTEST_RUNS_SPEC,
  GET_BACKTEST_RUN_SPEC,
  RUN_ATTRIBUTION_ANALYSIS_SPEC,
  SAVE_MEMORY_SPEC,
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
  /** 去重读（值发现，ADR-0011）：字段名；与 fields/date/security 互斥，仅行业域表 */
  distinct?: unknown;
  /** 去重读收窄：包含匹配 */
  keyword?: unknown;
}

export interface SaveMemoryArgs {
  op?: unknown;
  slug?: unknown;
  title?: unknown;
  content?: unknown;
}
