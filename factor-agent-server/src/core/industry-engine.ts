import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { DuckDBInstance, DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { FactorDataRow, FactorTableQuery } from './factor-data.service';

/* ==========================================================
   引擎 B（行业数据，ADR-0004 最小集）：
   - DuckDB 单文件库（SQL/industry/industry.duckdb，gitignore），
     启动/首查时从同目录 CSV 建表导入（源 mtime 新于库文件则重建）
   - resolveIndustrySecurities：industries + 决策日 → 时点归属证券清单（PIT，
     in_date ≤ D ≤ out_date，out_date 空 = 仍在册；证券后缀映射为引擎 A 口径）
   - industryReadTable：read_factor_data 的行业表路由实现（同一查表契约）
   与引擎 A 的分工：本引擎只服务 SQL/industry/tables.md 登记的行业域表。
   ========================================================== */

const logger = new Logger('IndustryEngine');

const INDUSTRY_DIR = path.resolve(__dirname, '..', '..', 'SQL', 'industry');
const DB_FILE = path.join(INDUSTRY_DIR, 'industry.duckdb');

/** 行业域表清单（字典即路由的读取侧登记处） */
export const INDUSTRY_TABLES = ['sw_classify', 'sw_member'] as const;

/** 池规格的来源组：组内并集、组间交集（ADR-0006） */
export type PoolGroup =
  | { kind: 'industry'; names: string[] }
  | { kind: 'index'; codes: string[] }
  | { kind: 'list'; ids: string[] };

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

/** 决策日 D 的时点归属：industries（申万一级行业名）→ 证券清单（引擎 A 口径后缀）。
 *  未识别的行业名单独返回（调用方决定澄清/忽略）。 */
export async function resolveIndustrySecurities(
  industries: string[],
  asOfDate: number,
): Promise<{ securities: string[]; unknown: string[] }> {
  if (!industries.length) return { securities: [], unknown: [] };
  const conn = await getConn();
  const asOf = String(asOfDate);
  const nameReader = await conn.runAndReadAll(
    "SELECT DISTINCT industry_name FROM sw_classify WHERE level = 'L1'",
  );
  const validNames = new Set((nameReader.getRowObjects() as Array<{ industry_name: string }>).map((r) => r.industry_name));
  const unknown = industries.filter((n) => !validNames.has(n));
  const placeholders = industries.map(() => '?').join(', ');
  const reader = await conn.runAndReadAll(
    `SELECT DISTINCT m.ts_code FROM sw_member m
     JOIN sw_classify c ON c.index_code = m.l1_code
     WHERE c.level = 'L1' AND c.industry_name IN (${placeholders})
       AND CAST(m.in_date AS VARCHAR) <= ?
       AND (m.out_date IS NULL OR CAST(m.out_date AS VARCHAR) = '' OR CAST(m.out_date AS VARCHAR) >= ?)`,
    [...industries, asOf, asOf] as DuckDBValue[],
  );
  const securities: string[] = [];
  for (const row of reader.getRowObjects() as Array<{ ts_code: string }>) {
    const mapped = toEngineSecurity(row.ts_code);
    if (mapped) securities.push(mapped);
  }
  return { securities, unknown };
}

/** 未识别行业的澄清指引（engine 回执/确认门共用） */
export async function industryClarificationGuide(industries: string[]): Promise<Record<string, unknown>> {
  const conn = await getConn();
  const reader = await conn.runAndReadAll(
    "SELECT industry_name FROM sw_classify WHERE level = 'L1' ORDER BY industry_name",
  );
  const names = (reader.getRowObjects() as Array<{ industry_name: string }>).map((r) => r.industry_name);
  return {
    需要澄清: `以下行业名不在申万 2021 一级行业中：${industries.join('、')}。请从名录中修正后重试`,
    可用行业: names.join('、'),
  };
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
    if (kind === 'industry') {
      const names = list('names');
      if (!names.length) throw new ApiException('INVALID_ARGUMENT', 400, 'industry 组的 names 必须是非空行业名数组（如 ["食品饮料"]）');
      return { kind: 'industry', names };
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
    throw new ApiException('INVALID_ARGUMENT', 400, `筛选组 kind 只允许 industry / index / list: ${String(kind)}`);
  });
}

/** 规格 → 展示摘要（筛选工具回执与回测卡共用同一口径）：组内 ∪、组间 ∩ */
export function describePoolSpec(groups: PoolGroup[]): string {
  const describeGroup = (g: PoolGroup): string => {
    if (g.kind === 'industry') return g.names.join('∪');
    if (g.kind === 'index') return g.codes.map((c) => INDEX_NAMES[c] ?? c).join('∪');
    return `点名${g.ids.length}只`;
  };
  return groups.map(describeGroup).join('∩');
}

/** 规格解析：每组来源组内并集，组间取交集。
 *  未识别行业/指数单独返回（调用方决定澄清，不污染已识别组）。 */
export async function resolvePoolSpec(
  groups: PoolGroup[],
  asOfDate: number,
): Promise<{ securities: string[]; unknownIndustry: string[]; unknownIndex: string[] }> {
  const groupSets: Set<string>[] = [];
  const unknownIndustry: string[] = [];
  const unknownIndex: string[] = [];
  for (const g of groups) {
    if (g.kind === 'list') {
      groupSets.push(new Set(g.ids));
      continue;
    }
    if (g.kind === 'industry') {
      const { securities, unknown } = await resolveIndustrySecurities(g.names, asOfDate);
      unknownIndustry.push(...unknown);
      groupSets.push(new Set(securities));
      continue;
    }
    const { securities, unknown } = await resolveIndexSecurities(g.codes, asOfDate);
    unknownIndex.push(...unknown);
    groupSets.push(new Set(securities));
  }
  if (!groupSets.length) return { securities: [], unknownIndustry, unknownIndex };
  const merged = groupSets.reduce((acc, cur) => new Set([...acc].filter((x) => cur.has(x))));
  return { securities: [...merged], unknownIndustry, unknownIndex };
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
