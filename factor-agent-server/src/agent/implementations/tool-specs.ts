/* ==========================================================
   工具定义（OpenAI function 格式）：LangGraph 智能体绑定的 4 个工具 schema。

   本文件只放"声明"——工具名/描述/参数约束是 GLM 每轮请求都会看到的协议内容，
   执行逻辑在 langgraph-agent.service.ts 的 tools 节点（按 call.name 分发）。
   修改参数或描述只动本文件；表/字段白名单校验在 D 层（factor-schema + 取数服务），
   这里写的约束是给模型看的行为指引，服务端校验不依赖本文件。
   ========================================================== */

import { describeFunctions } from '../../core/weight-functions';

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

/** 工具 3：单点读数（常规行读 + 行业域表去重读/值发现，ADR-0011 链路复用不新增工具） */
export const READ_FACTOR_DATA_SPEC = {
  type: 'function' as const,
  function: {
    name: 'read_factor_data',
    description:
      '两种读法。常规行读：按 表/因子字段集合/交易日/证券代码 读取数据——' +
      'table 必须来自系统提示中的表目录，fields 必须来自 list_factor_fields 的返回，' +
      'date 为纯数字交易日（如 20210506），security 为证券或指数代码（如 000002.XSHE / 000001.XSHG 上证指数）；' +
      '股票因子表按全码匹配，指数/主表自动按交易代码+交易市场匹配，日期对无交易日列的静态表自动忽略。' +
      '去重读（值发现）：只传 table + distinct=字段名（可选 keyword 收窄），返回该字段在表内的去重取值清单，' +
      '筛选股票池前用它核实字段可用值；仅行业域表（sw_classify/sw_member）支持，与 fields/date/security 互斥。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '数据表名' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '常规行读必填：因子字段名列表',
        },
        date: { type: 'string', description: '常规行读必填：交易日，纯数字 YYYYMMDD，如 20210506' },
        security: { type: 'string', description: '常规行读必填：证券代码，如 000002.XSHE' },
        distinct: {
          type: 'string',
          description: '去重读：字段名，返回该字段在表内的去重取值清单（如 distinct="l2_name" 查 sw_member 的全部二级行业名）',
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
            '股票池：证券代码数组（如 ["000002.XSHE"]），只放用户点名或前置筛选的少量股票。缺省/空 = 全市场。' +
            '行业/指数等成分池改用 poolId（screen_stock_pool 产物），禁止手工拼成分清单；' +
            '触发模式（rebalanceIntervalDays=0）必须预声明触发域（本参数不能为空）',
        },
        poolId: {
          type: 'string',
          description:
            '股票池句柄（可选）：screen_stock_pool 返回的池句柄，回测仅在池内选股。' +
            '池成员按每个调仓日的时点归属解析（期内调样自动跟随），再与 securityIds 取交集；' +
            '句柄只在本会话内有效；触发模式（rebalanceIntervalDays=0）不支持',
        },
        keepFullyInvested: {
          type: 'boolean',
          description:
            '仓位维持（可选，默认不传=false=掘金对齐语义：卖出现金保留至下一调仓日，不自动回补）。' +
            '仅在用户明确要求"始终保持满仓/卖出现金立即买回"时才传 true；用户未要求时禁止传本参数',
        },
        limitUpDownSkip: {
          type: 'boolean',
          description:
            '涨跌停判定（可选，默认不传=true=开启）：执行价触及官方涨停价不买入、触及跌停价不卖出；' +
            '档位为交易所官方价自动分档（主板±10%/ST±5%/创业板·科创板±20%/北交所±30%）。' +
            '仅在与掘金等平台做复刻对照、且用户明确要求对照口径时才传 false（关闭=涨跌停价照常成交），用户未要求对照时禁止传本参数',
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
          description:
            '调仓间隔（必填，无默认值）：每隔多少个交易日调仓一次，如 5≈每周、10≈每两周、21≈每月、63≈每季。' +
            '=0 为触发模式（"满足条件就买"，须同时传 positionDeviatePct 并预声明触发域 securityIds；' +
            '此模式 sellRules 仅支持止盈/止损/最大回撤/最大持有天数，不支持字段条件与排名跌出）',
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
        slippageRate: {
          type: 'number',
          description:
            '单边滑点比例（小数，0.001 = 10bp，缺省 0 = 按执行价精确成交）：买入成交价向不利方向上滑、卖出下滑，但不越过涨跌停价。' +
            '仅当用户明确要求"考虑滑点/更保守的回测/按实际成交估算"时才传（如用户说"加 10 个点滑点"传 0.001）；用户未提时禁止传本参数',
        },
        executionTiming: {
          type: 'integer',
          enum: [0, 1, 2],
          description: '成交时点：0=次日开盘价成交（默认，果仁同款保守口径）/ 1=次日收盘价成交 / 2=信号日当日收盘价成交（尾盘单：当日收盘出信号、当日收盘价成交，零滞后，与掘金等平台当日撮合对齐，跨平台对照用）',
        },
        maxPositions: {
          type: 'integer',
          description: '最大持仓数，默认 10，上限 100，提案中注明"默认"。用户提到 topN/持仓 N 只/选 N 只时必须按用户说的数值传入（top5 → 5），禁止擅自换成默认值',
        },
        idealPositionPct: {
          type: 'number',
          description: '每只目标仓位 %，缺省 = 100/maxPositions（满仓等权）。用户说"每只 5% 仓位"之类时传入',
        },
        entryFilters: {
          type: 'array',
          maxItems: 10,
          description:
            '过滤因子：全部满足才入选（个股字段缺失视为不满足）。' +
            '可引用大盘字段（table=mkt_idxd，如 CLOSE_INDEX）做"股票池开关"——指数当日值对全市场取同一个数参与比较，' +
            '与择时（总仓位开关）互补：用户说"大盘在 XX 上方时买 A 类股票"用大盘条件，说"大盘不好就减仓"用 timingOverlay',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              op: { type: 'string', enum: ['>', '<', 'eq', 'bw'], description: '比较符：大于 / 小于 / 等于 / 区间（bw 时 value 传 [下限, 上限]）' },
              value: {
                description: '阈值；op=bw 时传二元区间数组如 [10, 30]（闭区间）。' +
                  '阈值必须落在字段真实值域内，拿不准先用 read_factor_data 抽样看值域再定，禁止拍脑袋填大数',
                type: ['number', 'array'],
                items: { type: 'number' },
              },
              indexCode: {
                type: 'string',
                enum: ['hs300', 'csi500', 'sse'],
                description: '仅大盘条件（table=mkt_idxd）可传：挂靠指数，缺省 sse（上证）',
              },
            },
            required: ['table', 'field', 'op', 'value'],
          },
        },
        sortFactors: {
          type: 'array',
          maxItems: 10,
          description:
            '排序因子：各因子截面分位数标准化（0~100）后加权合成综合分，按综合分降序取前 maxPositions。' +
            '缺省 = 引擎自动用默认排序因子（20 日动量 REVS20，值大优），提案前向用户说明这一点。' +
            '需要自定义因子权重时不要在这里传权重，改用 weightFn 函数参数',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              direction: { type: 'integer', enum: [1, -1], description: '排序方向：1=值大优（默认，如动量）/ -1=值小优（如低估值）' },
            },
            required: ['table', 'field', 'direction'],
          },
        },
        weightFn: {
          type: 'object',
          description:
            '权重函数（可选，缺省 = 常数比例等权）：每次调仓求值各排序因子的权重，因子截面由引擎供给，只需给函数名与旋钮参数。可用函数：\n' +
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
            '仓位函数（可选，缺省 = 常数比例等权）：每次调仓输出各候选股的目标买入金额（整手/现金由校验器修正）。' +
            '注意"指数级均线定总仓位"属于大盘择时，不要用仓位函数表达。可用函数：\n' +
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
        keepRules: {
          type: 'array',
          maxItems: 10,
          description:
            '不卖条件（可选）：命中的持仓继续持有，优先级高于全部卖出规则与调仓换出（跌出排名也不卖）；' +
            '大盘择时的仓位调整不受其保护。结构同 entryFilters 元素（个股字段条件，暂不支持指数表字段）。' +
            '用户说"满足 XX 就不卖""强势股不要被调出"时传入',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '数据表名，来自系统提示中的表目录' },
              field: { type: 'string', description: '字段名，来自 list_factor_fields 的返回' },
              op: { type: 'string', enum: ['>', '<', 'eq', 'bw'], description: '比较符；bw 时 value 传 [下限, 上限]' },
              value: {
                description: '阈值；op=bw 时传二元区间数组。阈值须在字段真实值域内，拿不准先 read_factor_data 抽样看值域再定',
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
          description:
            '排除时间段（可选）：回测剔除这些区间——段内不交易不调仓，持仓按冻结时点价估值（净值走平，行情涨跌不计入收益），' +
            '指标按全序列计算。用户说"剔除股灾那段""排除 XX 年上半年再回测"时传入',
          items: {
            type: 'object',
            properties: {
              start: { type: 'string', description: '排除段开始日，纯数字 YYYYMMDD' },
              end: { type: 'string', description: '排除段结束日，纯数字 YYYYMMDD' },
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

/** 排名分析工具：因子分段有效性评估（果仁「排名分析」对标，个股级 IC 口径） */
const RUN_RANK_ANALYSIS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_rank_analysis',
    description:
      '排名分析（因子有效性评估）：把股票池按排序因子的值分成 N 段，逐段对比下期收益，' +
      '并计算个股级 IC（因子值与下期收益的秩相关）均值/正概率/IR 与排列单调性——' +
      '判断一个排序因子有没有选股能力。用户问"这个因子有没有效/因子分段测试/排名 IC"时使用',
    parameters: {
      type: 'object',
      properties: {
        factor: {
          type: 'object',
          description: '分析因子（单个）：结构同 sortFactors 的元素',
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
        startDate: { type: 'string', description: '分析开始日，纯数字 YYYYMMDD。约束同回测：用户说过照传，相对时间按今天换算' },
        endDate: { type: 'string', description: '分析结束日，纯数字 YYYYMMDD。约束同 startDate' },
      },
      required: ['factor', 'intervalDays', 'startDate', 'endDate'],
    },
  },
} as const;

/** 因子相关性工具：2~10 个因子两两截面秩相关矩阵（多因子组合前判断冗余） */
const RUN_FACTOR_CORRELATION_SPEC = {  type: 'function' as const,
  function: {
    name: 'run_factor_correlation',
    description:
      '因子相关性矩阵：一批因子两两计算截面秩相关（逐采样期取均值，对称矩阵）——' +
      '多因子组合前判断冗余。用户问"这几个因子相关性高不高/有没有重复"时使用',
    parameters: {
      type: 'object',
      properties: {
        factors: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          description: '2~10 个因子（table/field/direction，结构同 sortFactors 元素）',
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
        startDate: { type: 'string', description: '分析开始日，纯数字 YYYYMMDD' },
        endDate: { type: 'string', description: '分析结束日，纯数字 YYYYMMDD' },
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
      '每日选股：不跑回测，直接回答"今天/某个历史日，这套条件选出哪些股票"——' +
      '按 过滤(entryFilters)+排序(sortFactors) 取综合分最高的前 maxPositions 只，口径与回测信号完全一致。' +
      '即查即得、零副作用，无需用户确认；用户问"现在选出来是什么/那天选了哪些股"时使用；' +
      'date 缺省 = 最近交易日（非交易日自动回落到前一交易日，回执会注明实际查询日）',
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
                description: '阈值；op=bw 时传二元区间数组。阈值必须落在字段真实值域内，拿不准先用 read_factor_data 抽样看值域再定',
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
          description:
            '权重函数（可选，缺省 = 常数比例等权）：与回测排序口径一致，每次选股求值因子权重。可用函数：\n' +
            describeFunctions('factor-weight'),
          properties: {
            name: { type: 'string', description: '函数名，从上方名录选择' },
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
          description: '股票池句柄（可选）：screen_stock_pool 返回的池句柄，按查询日时点归属收窄选股域，再与 securityIds 取交集',
        },
        maxPositions: { type: 'integer', description: '入选只数，默认 10，上限 100' },
        date: { type: 'string', description: '查询日，纯数字 YYYYMMDD；缺省 = 最近交易日' },
      },
    },
  },
} as const;

/** 全部工具 schema：bindTools 一次绑定，顺序即 prompt 里的工具编号 */
/** 工具 7：股票池筛选（ADR-0006/0011）：多组条件交并 → 池句柄；成员清单不进对话，回测/选股以 poolId 引用 */
export const SCREEN_STOCK_POOL_SPEC = {
  type: 'function' as const,
  function: {
    name: 'screen_stock_pool',
    description:
      '股票池筛选：把定义固定的证券集合（维度表字段/指数成分/点名清单）组合成可复用的股票池，返回池句柄（poolId）。' +
      '组内并集、组间交集，如 [白酒,家电] ∩ 沪深300。' +
      '字段取值必须先用 read_factor_data 去重读核实（传 table + distinct=字段名，可用 keyword 收窄），不要凭记忆猜测取值。' +
      '回测或每日选股传 poolId 即在池内选股；成员清单不进入对话（回执只有条件摘要与成员数），向用户转述时同样只引用条件与数量。' +
      '即查即得无需确认。用户点名少量股票时不必用本工具，直接在回测传 securityIds。',
    parameters: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          description: '筛选组数组：组内并集、组间交集',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['field', 'index', 'list'], description: '来源类型' },
              table: { type: 'string', description: 'kind=field 时必填：可筛维度表名（来自表目录，首批仅 sw_member）' },
              field: {
                type: 'string',
                description: 'kind=field 时必填：维度表字段名（来自 list_factor_fields，粒度由字段承载，如 l1_name/l2_name/l3_name）',
              },
              values: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'kind=field 时必填：字段取值数组（确切值来自 read_factor_data 去重读，注意精确匹配——' +
                  '如 l2_name 的酒类取值是"白酒Ⅱ"而非"白酒"）',
              },
              codes: {
                type: 'array',
                items: { type: 'string' },
                description: 'kind=index 时必填：指数代码，常用 000300.SH（沪深300）/ 000905.SH（中证500）/ 000016.SH（上证50）',
              },
              ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'kind=list 时必填：证券代码数组（000002.XSHE 形态）',
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

/** 工具 9：长期记忆三操作（ADR-0007）：新增/更新/删除一条用户记忆 */
export const SAVE_MEMORY_SPEC = {
  type: 'function' as const,
  function: {
    name: 'save_memory',
    description:
      '长期记忆维护：把用户的稳定偏好、研究结论等值得跨会话记住的事实存入本地记忆库，' +
      '下次对话自动可见。三种操作：add 新增（用户说"记住：XX"或陈述了值得长期记住的偏好/结论）；' +
      'update 更新（偏好变了，引用既有条目的 slug 覆盖，不要新增重复条目）；' +
      'delete 删除（用户说"忘掉 XX"）。' +
      '写入后必须在回复里告知用户记了/改了/删了什么。只存稳定事实，单次对话的临时信息不要存。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['add', 'update', 'delete'], description: '操作类型' },
        slug: {
          type: 'string',
          description:
            '条目标识（小写英文短横线，如 prefer-momentum）。add 必填（新起一个不与记忆块重复的）；' +
            'update/delete 必填且必须来自记忆块行首方括号内的既有 slug',
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
      '归因分析：对指定回测做个股贡献/卖出规则贡献/亏损行为（回撤窗/买错卖晚卖早踏空/尾部集中度）聚合，' +
      '并生成归因解读——用户要求"归因分析/为什么赚为什么亏/钱是哪只票赚的"时使用；' +
    '参数 card 原样照抄回执或 list_backtest_runs 里的卡片编号（如 card_2）',
    parameters: {
      type: 'object',
      properties: {
        card: { type: 'string', description: '卡片编号，原样照抄（如 card_2）' },
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
    description:
      '查询本会话的历史回测存档清单（卡片编号/日期/标题）——' +
      '用户要求"列出做过的回测/回看某次回测/把上次的调出来"时使用；' +
      '查到目标后调 get_backtest_run（传对应卡片编号）把该次结果调出展示。用户没提历史回测时禁止调用',
    parameters: { type: 'object', properties: {} },
  },
} as const;

/** 调取历史回测：按卡片编号取存档，完整卡片直达前端（摘要给模型） */
const GET_BACKTEST_RUN_SPEC = {
  type: 'function' as const,
  function: {
    name: 'get_backtest_run',
    description:
      '调取本会话某次历史回测的完整结果（净值曲线/交易明细/每期持仓在对话中展示）——' +
      '用户要求"回看/调出某次回测"时，先 list_backtest_runs 查清单再调本工具；多组对比场景把指标最优的一组调出展示',
    parameters: {
      type: 'object',
      properties: {
        card: { type: 'string', description: '卡片编号，原样照抄回执或清单里的值（如 card_2）' },
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
