/* ==========================================================
   工具定义（OpenAI function 格式）：LangGraph 智能体绑定的 4 个工具 schema。

   本文件只放"声明"——工具名/描述/参数约束是 GLM 每轮请求都会看到的协议内容，
   执行逻辑在 langgraph-agent.service.ts 的 tools 节点（按 call.name 分发）。
   修改参数或描述只动本文件；表/字段白名单校验在 D 层（factor-schema + 取数服务），
   这里写的约束是给模型看的行为指引，服务端校验不依赖本文件。
   ========================================================== */

/** 工具 1：列出全部可用数据表（tables.md 目录），选取因子前必须先调用 */
export const LIST_FACTOR_TABLES_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_factor_tables',
    description:
      '列出因子数据库中全部可用数据表（表名/中文名/说明/唯一键）。' +
      '为用户选取因子之前必须先调用本工具了解有哪些表，禁止凭记忆编造表名。',
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
      '表名必须来自 list_factor_tables 的返回；选出要用的因子后调用 read_factor_data 读数。',
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
      '按 表/因子字段集合/交易日/证券代码 读取因子数据。' +
      'table 与 fields 必须来自 list_factor_tables / list_factor_fields 的返回，' +
      'date 为纯数字交易日（如 20210506），security 为证券代码（如 000002.XSHE）。',
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

/** 工具 4：多因子等权合成回测出净值卡片；frequency 必填无默认值，缺了服务端会返回澄清指引 */
export const RUN_EQUAL_WEIGHT_BACKTEST_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_equal_weight_backtest',
    description:
      '对已选定的因子组做多因子等权回测并生成净值卡片：每个调仓日各因子先算截面分位数、' +
      '等权平均成综合分，按综合分取 Top-K 等权建仓，输出年化收益、最大回撤、夏普、胜率、' +
      '年化换手与净值/基准曲线。factors 中的表名与字段名必须来自 list_factor_tables / ' +
      'list_factor_fields 的返回；回测无需先用 read_factor_data 抽样验证数据；' +
      'frequency 为必填参数且无默认值，用户未指明调仓频率时必须先向用户询问，禁止自行假设。',
    parameters: {
      type: 'object',
      properties: {
        factors: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description:
            '参与合成的因子列表（1~10 个，等权）：每个因子各算截面分位数后等权平均成综合分',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: '因子表名，来自工具 1 的返回' },
              field: { type: 'string', description: '因子字段名，来自工具 2 的返回' },
              order: {
                type: 'string',
                enum: ['desc', 'asc'],
                description: '该因子的选股方向：desc 因子值越大越好（默认）/ asc 值越小越好（如低估值因子）',
              },
            },
            required: ['table', 'field'],
          },
        },
        startDate: { type: 'string', description: '回测开始日，纯数字 YYYYMMDD，如 20230104' },
        endDate: { type: 'string', description: '回测结束日，纯数字 YYYYMMDD，如 20251231' },
        frequency: {
          type: 'string',
          enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom'],
          description:
            '调仓频率（必填，无默认值）：daily 每日 / weekly 每周 / biweekly 每半月 / monthly 每月 / ' +
            'quarterly 每季 / semiannual 每半年 / annual 每年 / custom 自定义每 N 个交易日',
        },
        everyNTd: { type: 'integer', description: '仅 frequency=custom 时必填：每 N 个交易日调仓一次，5~120' },
        topK: { type: 'integer', description: '每期持仓只数，默认 50，上限 200' },
        benchmark: {
          type: 'string',
          enum: ['hs300', 'csi500', 'sse'],
          description: '业绩基准：hs300 沪深300（默认）/ csi500 中证500 / sse 上证指数',
        },
      },
      required: ['factors', 'startDate', 'endDate', 'frequency'],
    },
  },
};

/** 全部工具 schema：bindTools 一次绑定，顺序即 prompt 里的工具编号 */
export const AGENT_TOOL_SPECS = [
  LIST_FACTOR_TABLES_SPEC,
  LIST_FACTOR_FIELDS_SPEC,
  READ_FACTOR_DATA_SPEC,
  RUN_EQUAL_WEIGHT_BACKTEST_SPEC,
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
