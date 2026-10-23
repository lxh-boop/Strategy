import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { DuckDBInstance, DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { FactorDataRow, FactorTableQuery } from './factor-data.service';

/* ==========================================================
   引擎 B（行业数据，ADR-0004 最小集；筛选字段化 ADR-0011）：
   - DuckDB 单文件库（SQL/industry/industry.duckdb，gitignore），
     启动/首查时从同目录 CSV 建表导入（源 mtime 新于库文件则重建）
   - resolveFieldSecurities：可筛维度表字段值 + 决策日 → 时点归属证券清单（PIT，
     注册表声明时点列；证券后缀映射为引擎 A 口径）
   - industryFieldValues：去重读（值发现）——单字段去重取值 + keyword 收窄
   - industryReadTable：read_factor_data 的行业表路由实现（同一查表契约）
   与引擎 A 的分工：本引擎只服务 SQL/industry/tables.md 登记的行业域表。
   ========================================================== */

const logger = new Logger('IndustryEngine');

const INDUSTRY_DIR = path.resolve(__dirname, '..', '..', 'SQL', 'industry');
const DB_FILE = path.join(INDUSTRY_DIR, 'industry.duckdb');

/** 行业域表清单（字典即路由的读取侧登记处） */
export const INDUSTRY_TABLES = ['sw_classify', 'sw_member'] as const;

/** 池规格的来源组：组内并集、组间交集（ADR-0006/0011）：工具与引擎不感知行业与级别概念，粒度由字段名承载 */
export type PoolGroup =
  | { kind: 'field'; table: string; field: string; values: string[] }
  | { kind: 'index'; codes: string[] }
  | { kind: 'list'; ids: string[] };

/** 可筛维度表注册表（ADR-0011）：注册只闸池来源——每张表声明证券代码列与时点列，
 *  读数与值发现走统一查表路由不受此限。首批仅 sw_member；新增来源 = 注册一行，工具与提示词零改动。 */
export const SCREENABLE_TABLES: Record<string, { codeColumn: string; pit: { in: string; out: string } | null }> = {
  sw_member: { codeColumn: 'ts_code', pit: { in: 'in_date', out: 'out_date' } },
};

/** 常用指数代码 → 展示名（摘要与澄清指引用；库内有成分数据的指数不止这些） */
export const INDEX_NAMES: Record<string, string> = {
  '000300.SH': '沪深300',
  '000905.SH': '中证500',
  '000016.SH': '上证50',
};

/** Tushare 代码后缀 → 引擎 A 证券代码后缀；北交所无对应落地（引擎 A 因子表未覆盖），跳过 */
function toEngineSecurity(tsCode: string): string | null {
  if (tsCode.endsWith('.SH')) return tsCode.replace(/\.SH$/, '.XSHG');
  if (tsCode.endsWith('.SZ')) return tsCode.replace(/\.SZ$/, '.XSHE');
  return null;
}

let connPromise: Promise<DuckDBConnection> | null = null;

async function getConn(): Promise<DuckDBConnection> {
  if (!connPromise) connPromise = init();
  return connPromise;
}

async function init(): Promise<DuckDBConnection> {
  assertSourcesExist();
  const instance = await DuckDBInstance.create(DB_FILE);
  const conn = await instance.connect();
  if (await needRebuild(conn)) {
    logger.log('行业库缺失或源 CSV 更新，重建中…');
    const csv = (name: string): string => path.join(INDUSTRY_DIR, name).replaceAll('\\', '/');
    await conn.run('DROP TABLE IF EXISTS sw_member');
    await conn.run('DROP TABLE IF EXISTS sw_classify');
    await conn.run(`CREATE TABLE sw_classify AS SELECT * FROM read_csv_auto('${csv('sw2021_classify.csv')}', header=true)`);
    // 在册（is_new=Y）与已调出（is_new=N）合并为一张 PIT 成员表
    await conn.run(`CREATE TABLE sw_member AS SELECT * FROM read_csv_auto('${csv('sw_member_current.csv')}', header=true)`);
    await conn.run(`INSERT INTO sw_member SELECT * FROM read_csv_auto('${csv('sw_member_historical.csv')}', header=true)`);
    // 指数成分快照（v1 新增）：CSV 缺失时降级跳过（不影响行业功能），用到时 resolveIndexSecurities fail fast
    await conn.run('DROP TABLE IF EXISTS idx_member');
    if (fs.existsSync(path.join(INDUSTRY_DIR, 'idx_member.csv'))) {
      await conn.run(`CREATE TABLE idx_member AS SELECT * FROM read_csv_auto('${csv('idx_member.csv')}', header=true)`);
      logger.log('指数成分表 idx_member 已导入');
    } else {
      logger.warn('idx_member.csv 缺失，指数成分来源不可用（跑 download-industry.mjs 补数据）');
    }
    logger.log('行业库重建完成');
  }
  return conn;
}

function assertSourcesExist(): void {
  for (const name of ['sw2021_classify.csv', 'sw_member_current.csv', 'sw_member_historical.csv']) {
    if (!fs.existsSync(path.join(INDUSTRY_DIR, name))) {
      throw new ApiException('INVALID_ARGUMENT', 500, `行业数据源缺失：SQL/industry/${name}，请先运行 download-industry.mjs 下载`);
    }
  }
}

async function needRebuild(conn: DuckDBConnection): Promise<boolean> {
  try {
    const reader = await conn.runAndReadAll("SELECT count(*) AS n FROM duckdb_tables() WHERE table_name IN ('sw_classify', 'sw_member')");
    const rows = reader.getRowObjects() as Array<{ n: unknown }>;
    if (Number(rows[0]?.n ?? 0) < 2) return true;
    const dbMtime = fs.statSync(DB_FILE).mtimeMs;
    return ['sw2021_classify.csv', 'sw_member_current.csv', 'sw_member_historical.csv', 'idx_member.csv'].some((name) => {
      try {
        return fs.statSync(path.join(INDUSTRY_DIR, name)).mtimeMs > dbMtime;
      } catch {
        return false;
      }
    });
  } catch {
    return true;
  }
}

function toRows(rows: Array<Record<string, unknown>>): FactorDataRow[] {
  // BigInt（DuckDB 整型）转 number，保证 JSON 回执可序列化
  return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as FactorDataRow[];
}

/** 表字段存在性校验：表名来自白名单/注册表（无注入面），字段名拼 SQL 前先对真实列核对 */
async function assertTableColumn(table: string, field: string): Promise<void> {
  const conn = await getConn();
  const cols = await conn.runAndReadAll(`DESCRIBE ${table}`);
  const names = new Set((cols.getRowObjects() as Array<{ column_name: string }>).map((r) => r.column_name));
  if (!names.has(field)) {
    throw new ApiException('INVALID_ARGUMENT', 400, `字段 ${field} 不在表 ${table} 中：请先 list_factor_fields(${table}) 核对列名`);
  }
}

/** 决策日 D 的字段值归属：可筛维度表 field ∈ values → 证券清单（注册表 PIT 归属，ADR-0011）。
 *  未命中的值单独返回（调用方指路去重读，不内嵌名录）。 */
export async function resolveFieldSecurities(
  table: string,
  field: string,
  values: string[],
  asOfDate: number,
): Promise<{ securities: string[]; unknown: string[] }> {
  const reg = SCREENABLE_TABLES[table];
  if (!reg) {
    throw new ApiException('INVALID_ARGUMENT', 400, `表 ${table} 未注册为可筛维度表：可选 ${Object.keys(SCREENABLE_TABLES).join('、')}`);
  }
  if (!values.length) return { securities: [], unknown: [] };
  await assertTableColumn(table, field);
  const conn = await getConn();
  const asOf = String(asOfDate);
  const allReader = await conn.runAndReadAll(`SELECT DISTINCT "${field}" AS v FROM ${table}`);
  const known = new Set((allReader.getRowObjects() as Array<{ v: unknown }>).map((r) => String(r.v ?? '')));
  const unknown = values.filter((v) => !known.has(v));
  const placeholders = values.map(() => '?').join(', ');
  const pitConds = reg.pit
    ? ` AND CAST(${reg.pit.in} AS VARCHAR) <= ?` +
      ` AND (${reg.pit.out} IS NULL OR CAST(${reg.pit.out} AS VARCHAR) = '' OR CAST(${reg.pit.out} AS VARCHAR) >= ?)`
    : '';
  const params: DuckDBValue[] = [...values];
  if (reg.pit) params.push(asOf, asOf);
  const reader = await conn.runAndReadAll(
    `SELECT DISTINCT ${reg.codeColumn} AS code FROM ${table} WHERE "${field}" IN (${placeholders})${pitConds}`,
    params,
  );
  const securities: string[] = [];
  for (const row of reader.getRowObjects() as Array<{ code: string }>) {
    const mapped = toEngineSecurity(row.code);
    if (mapped) securities.push(mapped);
  }
  return { securities, unknown };
}

/** 未命中字段值的澄清指引（指路不铺路，ADR-0011）：回执只给查询方法，不内嵌名录 */
export function fieldClarificationGuide(
  unknowns: Array<{ table: string; field: string; values: string[] }>,
): Record<string, unknown> {
  const detail = unknowns.map((u) => `${u.table}.${u.field} 中不存在这些值：${u.values.join('、')}`).join('；');
  return {
    需要澄清:
      `${detail}。请先用 read_factor_data 去重读核对该字段可用值（传 table + distinct=字段名，可用 keyword 收窄），` +
      '再用确切值重新筛选',
  };
}

/** 值发现上限（去重读结果都是短标签，346 个三级名也在顶内；keyword 收窄仍建议） */
export const FIELD_VALUES_CAP = 500;

/** 值发现（去重读的引擎侧实现，ADR-0011）：单字段去重取值 + keyword 包含收窄 */
export async function industryFieldValues(
  table: string,
  field: string,
  keyword?: string,
): Promise<{ values: string[]; truncated: boolean }> {
  await assertTableColumn(table, field);
  const conn = await getConn();
  const conds: string[] = [];
  const params: DuckDBValue[] = [];
  if (keyword) {
    conds.push(`CAST("${field}" AS VARCHAR) LIKE ?`);
    params.push(`%${keyword}%`);
  }
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  const reader = await conn.runAndReadAll(
    `SELECT DISTINCT "${field}" AS v FROM ${table}${where} ORDER BY v LIMIT ${FIELD_VALUES_CAP + 1}`,
    params,
  );
  const rows = reader.getRowObjects() as Array<{ v: unknown }>;
  const values = rows
    .slice(0, FIELD_VALUES_CAP)
    .map((r) => String(r.v ?? '').trim())
    .filter(Boolean);
  return { values, truncated: rows.length > FIELD_VALUES_CAP };
}

/* ----- 池规格解析（ADR-0006）：组内并集、组间交集，成员逐决策日时点归属 ----- */

/** 库内已建快照的指数代码 → 快照日清单（库未建 idx_member 表时返回 null，调用方报数据源缺失） */
async function availableIndexSnapshots(): Promise<Map<string, number[]> | null> {
  const conn = await getConn();
  try {
    const reader = await conn.runAndReadAll('SELECT DISTINCT index_code, trade_date FROM idx_member');
    const map = new Map<string, number[]>();
    for (const row of reader.getRowObjects() as Array<{ index_code: string; trade_date: unknown }>) {
      const list = map.get(row.index_code) ?? [];
      list.push(Number(row.trade_date));
      map.set(row.index_code, list);
    }
    return map;
  } catch {
    return null; // 表不存在（idx_member.csv 未下载）
  }
}

/** 决策日 D 的指数成分：取每个指数 ≤ D 的最近快照成员并集。
 *  库里没有任何一个请求指数 → unknown 返回（调用方决定澄清）。 */
export async function resolveIndexSecurities(
  codes: string[],
  asOfDate: number,
): Promise<{ securities: string[]; unknown: string[] }> {
  if (!codes.length) return { securities: [], unknown: [] };
  const snapshots = await availableIndexSnapshots();
  if (!snapshots) {
    throw new ApiException('INVALID_ARGUMENT', 500, '指数成分数据源缺失：SQL/industry/idx_member.csv，请先运行 download-industry.mjs 下载');
  }
  const unknown = codes.filter((c) => !snapshots.has(c));
  const conn = await getConn();
  const securities: string[] = [];
  for (const code of codes.filter((c) => snapshots.has(c))) {
    const days = (snapshots.get(code) ?? []).filter((d) => d <= asOfDate);
    const latest = days.length ? Math.max(...days) : null;
    if (latest === null) continue; // 快照全部晚于决策日（数据起点晚于回测区间），该指数当期无成员
    const reader = await conn.runAndReadAll(
      'SELECT con_code FROM idx_member WHERE index_code = ? AND trade_date = ?',
      [code, String(latest)] as DuckDBValue[],
    );
    for (const row of reader.getRowObjects() as Array<{ con_code: string }>) {
      const mapped = toEngineSecurity(row.con_code);
      if (mapped) securities.push(mapped);
    }
  }
  return { securities, unknown };
}

/** 未识别指数代码的澄清指引 */
export async function indexClarificationGuide(codes: string[]): Promise<Record<string, unknown>> {
  const snapshots = (await availableIndexSnapshots()) ?? new Map<string, number[]>();
  const known = [...snapshots.keys()].map((c) => `${c}（${INDEX_NAMES[c] ?? '未知名称'}）`);
  return {
    需要澄清: `以下指数代码没有成分快照数据：${codes.join('、')}。请修正后重试`,
    可用指数: known.join('、') || '（暂无，请先运行 download-industry.mjs 下载成分快照）',
  };
}

/** GLM 入参 → 池规格（纯校验归一；结构不对抛 400 给模型自纠） */
export function assertPoolGroups(raw: unknown): PoolGroup[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiException('INVALID_ARGUMENT', 400, 'groups 必须是非空的筛选组数组（组间交集、组内并集）');
  }
  return raw.map((item): PoolGroup => {
    const g = item as Record<string, unknown>;
    const kind = g?.kind;
    const list = (key: string): string[] =>
      [...new Set((Array.isArray(g?.[key]) ? (g[key] as unknown[]) : []).map((v) => String(v ?? '').trim()).filter(Boolean))];
    if (kind === 'field') {
      const table = typeof g?.table === 'string' ? g.table.trim() : '';
      const field = typeof g?.field === 'string' ? g.field.trim() : '';
      const values = list('values');
      if (!table || !field || !values.length) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          'field 组需要 table + field + values（如 { kind:"field", table:"sw_member", field:"l2_name", values:["白酒"] }）',
        );
      }
      if (!SCREENABLE_TABLES[table]) {
        throw new ApiException('INVALID_ARGUMENT', 400, `表 ${table} 未注册为可筛维度表：可选 ${Object.keys(SCREENABLE_TABLES).join('、')}`);
      }
      return { kind: 'field', table, field, values };
    }
    if (kind === 'index') {
      const codes = list('codes');
      if (!codes.length) throw new ApiException('INVALID_ARGUMENT', 400, 'index 组的 codes 必须是非空指数代码数组（如 ["000300.SH"]）');
      return { kind: 'index', codes };
    }
    if (kind === 'list') {
      const ids = list('ids');
      if (!ids.length) throw new ApiException('INVALID_ARGUMENT', 400, 'list 组的 ids 必须是非空证券代码数组（如 ["000002.XSHE"]）');
      return { kind: 'list', ids };
    }
    throw new ApiException('INVALID_ARGUMENT', 400, `筛选组 kind 只允许 field / index / list: ${String(kind)}`);
  });
}

/** 规格 → 展示摘要（筛选工具回执与回测卡共用同一口径）：组内 ∪、组间 ∩；只拼值，表名字段名不进展示层 */
export function describePoolSpec(groups: PoolGroup[]): string {
  const describeGroup = (g: PoolGroup): string => {
    if (g.kind === 'field') return g.values.join('∪');
    if (g.kind === 'index') return g.codes.map((c) => INDEX_NAMES[c] ?? c).join('∪');
    return `点名${g.ids.length}只`;
  };
  return groups.map(describeGroup).join('∩');
}

/** 规格解析：每组来源组内并集，组间取交集。
 *  未命中字段值/未知指数单独返回（调用方决定澄清，不污染已识别组）。 */
export async function resolvePoolSpec(
  groups: PoolGroup[],
  asOfDate: number,
): Promise<{ securities: string[]; unknownField: Array<{ table: string; field: string; values: string[] }>; unknownIndex: string[] }> {
  const groupSets: Set<string>[] = [];
  const unknownField: Array<{ table: string; field: string; values: string[] }> = [];
  const unknownIndex: string[] = [];
  for (const g of groups) {
    if (g.kind === 'list') {
      groupSets.push(new Set(g.ids));
      continue;
    }
    if (g.kind === 'field') {
      const { securities, unknown } = await resolveFieldSecurities(g.table, g.field, g.values, asOfDate);
      if (unknown.length) unknownField.push({ table: g.table, field: g.field, values: unknown });
      groupSets.push(new Set(securities));
      continue;
    }
    const { securities, unknown } = await resolveIndexSecurities(g.codes, asOfDate);
    unknownIndex.push(...unknown);
    groupSets.push(new Set(securities));
  }
  if (!groupSets.length) return { securities: [], unknownField, unknownIndex };
  const merged = groupSets.reduce((acc, cur) => new Set([...acc].filter((x) => cur.has(x))));
  return { securities: [...merged], unknownField, unknownIndex };
}

/** read_factor_data 的行业表路由实现（契约同 FactorDataService.readTable）：
 *  - sw_member：date = 时点归属过滤（in ≤ date ≤ out，空 out = 在册）
 *  - sw_classify：date 不过滤（分类目录静态）
 *  fields 校验走路由后的字典白名单（loadTableFieldDetails 已按目录路由）。 */
export async function industryReadTable(query: FactorTableQuery): Promise<FactorDataRow[]> {
  const conn = await getConn();
  const conds: string[] = [];
  const params: DuckDBValue[] = [];
  if (query.security) {
    conds.push('ts_code = ?');
    params.push(query.security);
  }
  if (query.table === 'sw_member' && query.date) {
    conds.push('CAST(in_date AS VARCHAR) <= ?');
    params.push(query.date);
    conds.push("(out_date IS NULL OR CAST(out_date AS VARCHAR) = '' OR CAST(out_date AS VARCHAR) >= ?)");
    params.push(query.date);
  }
  const cols = query.fields?.length ? query.fields.map((f) => `"${f}"`).join(', ') : '*';
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  const reader = await conn.runAndReadAll(`SELECT ${cols} FROM ${query.table}${where}`, params);
  return toRows(reader.getRowObjects() as Array<Record<string, unknown>>);
}
