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
    return ['sw2021_classify.csv', 'sw_member_current.csv', 'sw_member_historical.csv'].some((name) => {
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
