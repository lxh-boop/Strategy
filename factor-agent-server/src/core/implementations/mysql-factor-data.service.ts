import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, Pool } from 'mysql2/promise';
import { ApiException } from '../../common/api.exception';
import { loadTableFields, listKnownTables } from '../factor-schema';
import {
  DATE_RE,
  CrossSectionRow,
  DailyCloseRow,
  FactorDataService,
  FactorDataRow,
  FactorTableQuery,
  IDENT_RE,
  IndexDailyRow,
  SECURITY_RE,
  TradeDateCoverage,
} from '../factor-data.service';

/* ==========================================================
   因子数据读取实现：MySQL（mysql2 连接池）
   - 表名/字段名只允许 [A-Za-z0-9_] 且反引号包裹，日期/证券代码走参数占位符，杜绝注入
   - 连接池按配置懒创建：.env 未配齐时不阻塞启动，首次取数时给出明确报错
   - readTable 服务 LLM 单点查询；readTradeDates/readCrossSection/readDailyCloses/
     readIndexDaily 服务等权回测的批量取数，同池同白名单
   ========================================================== */

/** 单次查询允许的最大因子字段数（防止拼接超长 SQL） */
const MAX_FIELDS = 200;

/** 批量日收盘按代码分片查询的大小（控制 IN 元组长度） */
const CODE_CHUNK = 400;

/** 交易日 YYYYMMDD → 行情表 DATE 参数 'YYYY-MM-DD' */
function toDashDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** decimal 列按字符串返回，这里统一转 number（NULL 已在调用处处理） */
function toNum(v: unknown): number {
  return Number(v);
}

@Injectable()
export class MysqlFactorDataService extends FactorDataService {
  private readonly logger = new Logger('MysqlFactorData');
  private pool: Pool | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  async readTable(query: FactorTableQuery): Promise<FactorDataRow[]> {
    const { table, fields, date, security } = query;
    const columnList = this.buildColumnList(table, fields ?? [], date, security);

    const sql = `SELECT ${columnList} FROM \`${table}\` WHERE SECURITY_ID = ? AND TRADE_DATE = ?`;
    const rows = await this.query(sql, [security, Number(date)]);
    this.logger.log(`${table} ${security} ${date}: ${fields?.length ?? '全部列'} 字段，${rows.length} 行`);
    return rows as FactorDataRow[];
  }

  async readTradeDates(table: string, start: string, end: string): Promise<TradeDateCoverage> {
    this.assertTable(table);
    this.assertRange(start, end);
    const rangeRows = await this.query(`SELECT MIN(TRADE_DATE) AS mn, MAX(TRADE_DATE) AS mx FROM \`${table}\``, []);
    const range = rangeRows[0] as { mn: number | null; mx: number | null };
    if (range.mn === null || range.mx === null) {
      throw new ApiException('DATA_SOURCE_ERROR', 502, `表 ${table} 无数据，无法确定可用区间`);
    }
    const rows = await this.query(
      `SELECT DISTINCT TRADE_DATE AS d FROM \`${table}\` WHERE TRADE_DATE BETWEEN ? AND ? ORDER BY TRADE_DATE`,
      [Number(start), Number(end)],
    );
    const dates = rows.map((r) => Number((r as { d: number }).d));
    this.logger.log(`${table} 交易日 ${start}~${end}: ${dates.length} 天（全表 ${range.mn}~${range.mx}）`);
    return { dates, min: Number(range.mn), max: Number(range.mx) };
  }

  async readCrossSection(table: string, field: string, date: string): Promise<CrossSectionRow[]> {
    this.assertTable(table);
    this.assertField(table, field);
    if (!DATE_RE.test(date)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `日期必须是纯数字 YYYYMMDD: ${date}`);
    }
    const sql =
      `SELECT SECURITY_ID, \`${field}\` AS v FROM \`${table}\` ` +
      `WHERE TRADE_DATE = ? AND \`${field}\` IS NOT NULL`;
    const rows = await this.query(sql, [Number(date)]);
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return { securityId: String(row.SECURITY_ID), value: toNum(row.v) };
    });
  }

  async readDailyCloses(table: string, codes: string[], start: string, end: string): Promise<DailyCloseRow[]> {
    this.assertTable(table);
    this.assertRange(start, end);
    const unique = [...new Set(codes)];
    for (const code of unique) {
      if (!SECURITY_RE.test(code)) {
        throw new ApiException('INVALID_ARGUMENT', 400, `证券代码格式须为 000002.XSHE: ${code}`);
      }
    }
    const startDash = toDashDate(start);
    const endDash = toDashDate(end);
    const all: DailyCloseRow[] = [];
    for (let i = 0; i < unique.length; i += CODE_CHUNK) {
      const chunk = unique.slice(i, i + CODE_CHUNK).map((code) => {
        const [ticker, exchange] = code.split('.');
        return { ticker, exchange };
      });
      const placeholders = chunk.map(() => '(?, ?)').join(', ');
      const params: (string | number)[] = [startDash, endDash];
      for (const c of chunk) params.push(c.ticker, c.exchange);
      const sql =
        `SELECT TICKER_SYMBOL, EXCHANGE_CD, TRADE_DATE, CLOSE_PRICE_1 FROM \`${table}\` ` +
        `WHERE TRADE_DATE BETWEEN ? AND ? AND CLOSE_PRICE_1 IS NOT NULL ` +
        `AND (TICKER_SYMBOL, EXCHANGE_CD) IN (${placeholders}) ORDER BY TRADE_DATE`;
      const rows = await this.query(sql, params);
      for (const row of rows as Record<string, unknown>[]) {
        all.push({
          ticker: String(row.TICKER_SYMBOL),
          exchange: String(row.EXCHANGE_CD),
          tradeDate: String(row.TRADE_DATE),
          closeAdj: toNum(row.CLOSE_PRICE_1),
        });
      }
    }
    this.logger.log(`${table} 日收盘 ${start}~${end}: ${unique.length} 只，${all.length} 行`);
    return all;
  }

  async readIndexDaily(table: string, ticker: string, start: string, end: string): Promise<IndexDailyRow[]> {
    this.assertTable(table);
    this.assertRange(start, end);
    if (!/^\d{6}$/.test(ticker)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `指数代码格式须为 6 位数字（如 000300）: ${ticker}`);
    }
    const sql =
      `SELECT TRADE_DATE, CLOSE_INDEX, PRE_CLOSE_INDEX FROM \`${table}\` ` +
      `WHERE TICKER_SYMBOL = ? AND TRADE_DATE BETWEEN ? AND ? ORDER BY TRADE_DATE`;
    const rows = await this.query(sql, [ticker, toDashDate(start), toDashDate(end)]);
    return (rows as Record<string, unknown>[]).map((row) => ({
      tradeDate: String(row.TRADE_DATE),
      close: toNum(row.CLOSE_INDEX),
      preClose: toNum(row.PRE_CLOSE_INDEX),
    }));
  }

  /** 表名白名单：必须出自 SQL/tables.md */
  private assertTable(table: string): void {
    if (!IDENT_RE.test(table)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `非法表名: ${table}`);
    }
    if (!listKnownTables().includes(table)) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `表不在字段字典中（SQL/tables.md）: ${table}。可用表: ${listKnownTables().join(', ') || '（无）'}`,
      );
    }
  }

  /** 字段白名单：必须出自 SQL/<表名>.md */
  private assertField(table: string, field: string): void {
    if (!IDENT_RE.test(field)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `非法字段名: ${field}`);
    }
    if (!loadTableFields(table)?.has(field)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `表 ${table} 无此因子字段（见 SQL/${table}.md）: ${field}`);
    }
  }

  /** 回测区间：两端纯数字且 start < end */
  private assertRange(start: string, end: string): void {
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `区间日期必须是纯数字 YYYYMMDD: ${start} ~ ${end}`);
    }
    if (Number(start) >= Number(end)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `区间非法：start 必须早于 end: ${start} ~ ${end}`);
    }
  }

  /** SELECT 列清单：固定带出 SECURITY_ID / TRADE_DATE，其余按传入顺序去重拼接。
   *  表名 / 因子字段必须是 SQL 目录字段字典（tables.md + <表名>.md）里出现过的。 */
  private buildColumnList(table: string, fields: string[], date: string, security: string): string {
    if (!IDENT_RE.test(table)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `非法表名: ${table}`);
    }
    if (!DATE_RE.test(date)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `日期必须是纯数字 YYYYMMDD: ${date}`);
    }
    if (!SECURITY_RE.test(security)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `证券代码格式须为 000002.XSHE: ${security}`);
    }
    if (fields.length > MAX_FIELDS) {
      throw new ApiException('INVALID_ARGUMENT', 400, `因子字段过多（>${MAX_FIELDS}）`);
    }

    // 字段字典白名单（按表现读，不缓存）：表必须在 tables.md 中，字段必须在该表 <表名>.md 里出现过
    const knownFields = loadTableFields(table);
    if (!knownFields) {
      const available = listKnownTables();
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `表不在字段字典中（SQL/tables.md）: ${table}。可用表: ${available.join(', ') || '（无）'}`,
      );
    }
    for (const f of fields) {
      if (!IDENT_RE.test(f)) {
        throw new ApiException('INVALID_ARGUMENT', 400, `非法字段名: ${f}`);
      }
      if (!knownFields.has(f)) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `表 ${table} 无此因子字段（见 SQL/${table}.md）: ${f}`,
        );
      }
    }

    // 传入集合里可能含固定键列，过滤避免 SELECT 重复列
    const unique = [...new Set(fields)].filter((f) => f !== 'SECURITY_ID' && f !== 'TRADE_DATE');
    const columns = unique.length === 0 ? ['*'] : ['SECURITY_ID', 'TRADE_DATE', ...unique];
    return columns.map((c) => (c === '*' ? '*' : `\`${c}\``)).join(', ');
  }

  /** 连接池懒创建；配置缺失时给出可操作的报错信息 */
  private getPool(): Pool {
    if (this.pool) return this.pool;
    const mysql = this.config.getOrThrow<{
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      connectionLimit: number;
    }>('mysql');
    if (!mysql.user) {
      throw new ApiException('DATA_SOURCE_ERROR', 502, 'MySQL 未配置：请在 .env 中填写 MYSQL_USER / MYSQL_PASSWORD 等连接信息');
    }
    this.pool = createPool({
      host: mysql.host,
      port: mysql.port,
      user: mysql.user,
      password: mysql.password,
      database: mysql.database,
      connectionLimit: mysql.connectionLimit,
      // 多数因子列是 decimal(20,4)，按字符串返回避免精度丢失，由调用方自行 Number()
      decimalNumbers: false,
      dateStrings: true,
    });
    return this.pool;
  }

  private async query(sql: string, params: (string | number)[]): Promise<unknown[]> {
    try {
      const [rows] = await this.getPool().execute(sql, params);
      return rows as unknown[];
    } catch (error) {
      const msg = (error as Error).message.slice(0, 200);
      this.logger.error(`取数失败: ${msg}`);
      throw new ApiException('DATA_SOURCE_ERROR', 502, `MySQL 取数失败: ${msg}`);
    }
  }
}
