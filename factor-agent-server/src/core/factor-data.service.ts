import { Injectable } from '@nestjs/common';

/* ==========================================================
   因子数据读取接口（契约层）—— 定义"按表 + 因子集合 + 日期 + 股票读库能做什么"。
   实现：implementations/mysql-factor-data.service.ts（MySQL information_schema/herms_data 库）
   白名单：表名 / 因子字段必须是 <项目根>/SQL 字段字典里出现过的
   （tables.md 给表清单，<表名>.md 给该表字段；解析见 factor-schema.ts）
   调用方：C 智能体（先查表描述 → 按需加载表字段 → 选因子 → 调本接口取数）
   ========================================================== */

/** 合法标识符：表名 / 字段名（只允许字母、数字、下划线，防注入） */
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 交易日：纯数字 YYYYMMDD，如 20210506（对应 TRADE_DATE bigint） */
export const DATE_RE = /^\d{8}$/;

/** 证券代码：6 位数字代码 + 交易所后缀，如 000002.XSHE */
export const SECURITY_RE = /^\d{6}\.[A-Za-z]{2,8}$/;

/** 取数请求：指定表 + 表中的因子字段集合 + 交易日 + 证券代码 */
export interface FactorTableQuery {
  /** 表名，如 eq_u_factor_derive */
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
}
