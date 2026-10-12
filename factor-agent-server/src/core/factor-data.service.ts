import { Injectable } from '@nestjs/common';

/* ==========================================================
   因子数据读取接口（契约层）—— 定义"按表 + 因子集合 + 日期 + 股票读库能做什么"。
   实现：implementations/mysql-factor-data.service.ts（MySQL herms_data 库）
   白名单：表名 / 因子字段必须是 <项目根>/SQL 字段字典里出现过的
   （tables.md 给表清单，<表名>.md 给该表字段；解析见 factor-schema.ts）
   调用方：C 智能体（先查表描述 → 按需加载表字段 → 选因子 → 调本接口取数），
           策略回测引擎（readTradeDates / readFactorSections / readFactorRange /
           readQuoteSeries / readIndexDaily，服务端内部调用，同样走字典白名单）
   ========================================================== */

/** 合法标识符：表名 / 字段名（只允许字母、数字、下划线，防注入） */
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 交易日：纯数字 YYYYMMDD，如 20210506（对应因子表 TRADE_DATE bigint） */
export const DATE_RE = /^\d{8}$/;

/** 证券代码：6 位数字代码 + 交易所后缀，如 000002.XSHE */
export const SECURITY_RE = /^\d{6}\.[A-Za-z]{2,8}$/;

/** 取数请求：指定表 + 表中的因子字段集合 + 交易日 + 证券代码 */
export interface FactorTableQuery {
  /** 表名，如 equ_factor_derive */
  table: string;
  /** 因子字段集合（列名）；缺省或空数组 = 读取全部列 */
  fields?: string[];
  /** 交易日，纯数字 YYYYMMDD，如 20210506 */
  date: string;
  /** 证券代码，如 000002.XSHE */
  security: string;
}

/** 取数结果的一行：列名 → 值（列名即字段注释对应的原始字段名） */
export type FactorDataRow = Record<string, unknown>;

/** 因子数据读取：按 表 + 因子集合 + 交易日 + 证券代码 查询行情/财务因子数据 */
@Injectable()
export abstract class FactorDataService {
  abstract readTable(query: FactorTableQuery): Promise<FactorDataRow[]>;

  /* ----- 以下为策略回测引擎的批量取数方法（同池同白名单，日期参数均为纯数字 YYYYMMDD） ----- */

  /** 因子表交易日覆盖：[start,end] 内有因子数据的交易日序列（升序）+ 全表日期范围。
   *  用于确定回测日历与校验请求区间是否落在数据范围内。 */
  abstract readTradeDates(table: string, start: string, end: string): Promise<TradeDateCoverage>;

  /** 单因子截面：指定交易日内（codes 为 null = 全市场）该字段全部非空 (证券代码, 因子值)。
   *  无 TRADE_DATE 列的静态表（如 md_security 主表）忽略日期条件，返回全量截面。
   *  调仓日过滤/排序的原始截面，合成与选目标由引擎计算。 */
  abstract readFactorSection(table: string, field: string, date: string, codes: string[] | null): Promise<CrossSectionRow[]>;

  /** 单因子区间序列：一批证券在 [start,end] 每个交易日的因子值（卖出规则逐日检查用）。
   *  静态表（无 TRADE_DATE 列）返回一行/股，tradeDate 为空串——值与日期无关。 */
  abstract readFactorRange(table: string, field: string, codes: string[], start: string, end: string): Promise<FactorRangeRow[]>;

  /** 个股日线（前复权）：一批证券代码在 [start,end] 的开盘/收盘/昨收盘。
   *  引擎成交用开盘或收盘价，结算与涨跌停判定用收盘/昨收；停牌日无行。 */
  abstract readQuoteSeries(codes: string[], start: string, end: string): Promise<QuoteRow[]>;

  /** 指数日线（回测基准）：[start,end] 的收盘/昨收盘，日收益 = close / preClose - 1。 */
  abstract readIndexDaily(table: string, ticker: string, start: string, end: string): Promise<IndexDailyRow[]>;
}

/** 因子表交易日覆盖 */
export interface TradeDateCoverage {
  /** [start,end] 内有因子数据的交易日，升序 YYYYMMDD */
  dates: number[];
  /** 全表最早交易日（YYYYMMDD） */
  min: number;
  /** 全表最晚交易日（YYYYMMDD） */
  max: number;
}

/** 单因子截面一行 */
export interface CrossSectionRow {
  /** 证券代码，如 000002.XSHE */
  securityId: string;
  /** 因子值（decimal 已转 number） */
  value: number;
}

/** 单因子区间序列一行 */
export interface FactorRangeRow {
  /** 证券代码，如 000002.XSHE */
  securityId: string;
  /** 交易日 'YYYY-MM-DD'；静态表为空串 */
  tradeDate: string;
  value: number;
}

/** 个股日线（前复权）一行 */
export interface QuoteRow {
  /** 6 位交易代码 */
  ticker: string;
  /** 交易市场代码：XSHG / XSHE / XBEI */
  exchange: string;
  /** 交易日 'YYYY-MM-DD' */
  tradeDate: string;
  /** 前复权开盘价（executionTiming=0 的成交价；可能为 null） */
  open: number | null;
  /** 前复权收盘价（结算与 executionTiming=1 的成交价） */
  close: number;
  /** 前复权昨收盘（涨跌停判定基准） */
  preClose: number;
}

/** 指数日线一行 */
export interface IndexDailyRow {
  /** 交易日 'YYYY-MM-DD' */
  tradeDate: string;
  close: number;
  preClose: number;
}
