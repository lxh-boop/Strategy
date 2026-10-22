import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, Pool } from 'mysql2/promise';
import { ApiException } from '../../common/api.exception';
import { loadTableFieldDetails, loadTableFields, listKnownTables } from '../factor-schema';
import {
  DATE_RE,
  CrossSectionRow,
  FactorDataService,
  FactorDataRow,
  FactorRangeRow,
  FactorTableQuery,
  IDENT_RE,
  IndexDailyRow,
  IndexFieldRow,
  QuoteRow,
  SECURITY_RE,
  TradeDateCoverage,
} from '../factor-data.service';

/* ==========================================================
   因子数据读取实现：MySQL（mysql2 连接池）
   - 表名/字段名只允许 [A-Za-z0-9_] 且反引号包裹，日期/证券代码走参数占位符，杜绝注入
   - 连接池按配置懒创建：.env 未配齐时不阻塞启动，首次取数时给出明确报错
   - readTable 服务 LLM 单点查询，SQL 形状由字段字典推导（日期列/证券列按表里实际有什么拼什么，
     指数表/主表/ID 键表都能读）；readTradeDates/readFactorSection/readFactorRange/
     readQuoteSeries/readIndexDaily 服务策略回测引擎的批量取数，同池同白名单
   - 无 TRADE_DATE 列的静态表（md_security 等主表）截面/序列查询忽略日期条件
   - 取数结果带短 TTL 内存缓存（见 CACHE_TTL_MS）：历史行情/因子一经落库不再变化，
     重复回测/重复查询免打库；近期交易日被数据商修正的情形靠 TTL 过期兜底。
     只缓存在 query() 这一个收口点，白名单校验照常先行，缓存命中不影响任何校验语义
   ========================================================== */

/** 个股前复权日行情表（SQL/mkt_equd_adj.md）：引擎成交与结算的唯一行情源 */
const QUOTE_TABLE = 'mkt_equd_adj';

/** 指数日行情表（SQL/mkt_idxd.md），基准曲线数据源 */
const INDEX_TABLE = 'mkt_idxd';

/** 单次查询允许的最大因子字段数（防止拼接超长 SQL） */
const MAX_FIELDS = 200;

/** 批量查询按代码分片的大小（控制 IN 元组长度） */
const CODE_CHUNK = 400;

/** 单点读行数上限：read_factor_data 的结果直接进模型上下文，
 *  ID 键表（无证券/日期列可收窄）退化为截断的全表读，必须有顶 */
const ROW_LIMIT = 200;

/* ----- 取数缓存参数 -----
   历史行情/因子数据落库后不再变化，可安全复用；TTL 只为兜底两类情形：
   最近交易日的数据商修正、以及限制长驻进程的内存占用 */
/** 缓存条目存活时长（10 分钟） */
const CACHE_TTL_MS = 10 * 60_000;
/**
 * 缓存最大条目数（LRU 淘汰）。下限要按最重的单次回测算：
 * 长区间+高频调仓 ≈ 每个调仓日 1 条全市场截面 + 行情分片若干
 * （实测 2 年每 5 日调仓 = 97 个调仓日 ≈ 102 条），低于它会被自己挤垮、
 * 重复回测全部落空。200 留足余量；内存由 TTL（10 分钟过期）兜底
 */
const CACHE_MAX = 200;

/** 缓存条目：入库时间 + 结果集。结果集视为只读，调用方不得改写（当前各方法只做映射不修改） */
interface FactorCacheEntry {
  at: number;
  rows: unknown[];
}

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
  /** (sql+params) → 结果集；Map 迭代序 = 插入序，借它做 LRU：命中删了重插移到队尾，超容从队首删 */
  private readonly cache = new Map<string, FactorCacheEntry>();
  /** 同 key 并发查询去重：第一个请求打库，其余搭车等同一个 Promise */
  private readonly inflight = new Map<string, Promise<unknown[]>>();
  /** 累计命中次数（仅日志观察用） */
  private cacheHits = 0;

  constructor(private readonly config: ConfigService) {
    super();
  }

  /** LLM 单点读（read_factor_data）。SQL 形状完全由字段字典（SQL/<表名>.md）推导，不写死任何列：
   *  - 日期：字典有 TRADE_DATE 列才加日期条件，参数格式随字典类型（bigint 存 20210506 / date 存 'YYYY-MM-DD'）；
   *    无该列的静态主表忽略日期
   *  - 证券：字典有字符串形 SECURITY_ID（varchar，存 000002.XSHE 全码）→ 全码等值；
   *    否则有 TICKER_SYMBOL → 拆 '000001.XSHG' 为 6 位代码（+EXCHANGE_CD 市场，有才拼）；
   *    两者皆无的 ID 键表（md_type 等）不加证券条件
   *  - SELECT 列 = 条件列 + 去重后的请求字段（未指名因子字段 = *），行自带归属信息便于模型核对 */
  async readTable(query: FactorTableQuery): Promise<FactorDataRow[]> {
    const { table, date, security } = query;
    const fields = query.fields ?? [];
    if (!DATE_RE.test(date)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `日期必须是纯数字 YYYYMMDD: ${date}`);
    }
    if (!SECURITY_RE.test(security)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `证券代码格式须为 000002.XSHE: ${security}`);
    }
    if (fields.length > MAX_FIELDS) {
      throw new ApiException('INVALID_ARGUMENT', 400, `因子字段过多（>${MAX_FIELDS}）`);
    }

    this.assertTable(table);
    const details = loadTableFieldDetails(table) ?? [];
    const byName = new Map(details.map((d) => [d.name, d]));
    for (const f of fields) {
      if (!IDENT_RE.test(f)) {
        throw new ApiException('INVALID_ARGUMENT', 400, `非法字段名: ${f}`);
      }
      if (!byName.has(f)) {
        throw new ApiException('INVALID_ARGUMENT', 400, `表 ${table} 无此因子字段（见 SQL/${table}.md）: ${f}`);
      }
    }

    const conds: string[] = [];
    const params: (string | number)[] = [];
    const condCols: string[] = [];

    const dateCol = byName.get('TRADE_DATE');
    if (dateCol) {
      conds.push('TRADE_DATE = ?');
      params.push(/^date/.test(dateCol.type) ? toDashDate(date) : Number(date));
      condCols.push('TRADE_DATE');
    }

    const secCol = byName.get('SECURITY_ID');
    if (secCol && /^(varchar|char)/.test(secCol.type)) {
      conds.push('SECURITY_ID = ?');
      params.push(security);
      condCols.push('SECURITY_ID');
    } else if (byName.has('TICKER_SYMBOL')) {
      const [ticker, exchange] = security.split('.');
      conds.push('TICKER_SYMBOL = ?');
      params.push(ticker);
      condCols.push('TICKER_SYMBOL');
      if (byName.has('EXCHANGE_CD')) {
        conds.push('EXCHANGE_CD = ?');
        params.push(exchange);
        condCols.push('EXCHANGE_CD');
      }
    }

    const unique = [...new Set(fields)].filter((f) => !condCols.includes(f));
    const columnList = unique.length === 0 ? '*' : [...condCols, ...unique].map((c) => `\`${c}\``).join(', ');
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const sql = `SELECT ${columnList} FROM \`${table}\`${where} LIMIT ${ROW_LIMIT}`;
    const rows = await this.query(sql, params);
    this.logger.log(
      `${table} ${security} ${date}: ${fields.length} 字段，${rows.length} 行${rows.length >= ROW_LIMIT ? `（触顶截断 ${ROW_LIMIT}）` : ''}`,
    );
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

  async readFactorSection(table: string, field: string, date: string, codes: string[] | null): Promise<CrossSectionRow[]> {
    this.assertTable(table);
    this.assertField(table, field);
    if (!DATE_RE.test(date)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `日期必须是纯数字 YYYYMMDD: ${date}`);
    }
    const staticTable = this.isStaticTable(table);
    const all: CrossSectionRow[] = [];
    for (const chunk of this.chunkCodes(codes)) {
      const params: (string | number)[] = [];
      const conds: string[] = [`\`${field}\` IS NOT NULL`];
      if (!staticTable) {
        conds.push('TRADE_DATE = ?');
        params.push(Number(date));
      }
      if (chunk) {
        conds.push(`SECURITY_ID IN (${chunk.map(() => '?').join(', ')})`);
        params.push(...chunk);
      }
      const sql = `SELECT SECURITY_ID, \`${field}\` AS v FROM \`${table}\` WHERE ${conds.join(' AND ')}`;
      const rows = await this.query(sql, params);
      for (const row of rows as Record<string, unknown>[]) {
        all.push({ securityId: String(row.SECURITY_ID), value: toNum(row.v) });
      }
    }
    return all;
  }

  async readFactorRange(table: string, field: string, codes: string[], start: string, end: string): Promise<FactorRangeRow[]> {
    this.assertTable(table);
    this.assertField(table, field);
    this.assertRange(start, end);
    const staticTable = this.isStaticTable(table);
    const all: FactorRangeRow[] = [];
    for (const chunk of this.chunkCodes([...new Set(codes)])) {
      const conds: string[] = [`\`${field}\` IS NOT NULL`];
      const params: (string | number)[] = [];
      if (!staticTable) {
        // 因子表 TRADE_DATE 为 BIGINT（yyyymmdd 整数）：必须用裸数字日期。
        // dash 日期（'2025-01-01'）会被数值强转成 2025 → 区间恒空 → 字段类卖出
        // 规则与不卖条件静默失效（2026-10-22 掘金对照实验定位）
        conds.push('TRADE_DATE BETWEEN ? AND ?');
        params.push(start, end);
      }
      if (chunk) {
        conds.push(`SECURITY_ID IN (${chunk.map(() => '?').join(', ')})`);
        params.push(...chunk);
      }
      const sql = `SELECT SECURITY_ID${staticTable ? '' : ', TRADE_DATE'}, \`${field}\` AS v FROM \`${table}\` WHERE ${conds.join(' AND ')}`;
      const rows = await this.query(sql, params);
      for (const row of rows as Record<string, unknown>[]) {
        all.push({
          securityId: String(row.SECURITY_ID),
          tradeDate: row.TRADE_DATE === undefined ? '' : String(row.TRADE_DATE),
          value: toNum(row.v),
        });
      }
    }
    return all;
  }

  async readQuoteSeries(codes: string[], start: string, end: string): Promise<QuoteRow[]> {
    this.assertTable(QUOTE_TABLE);
    this.assertRange(start, end);
    const unique = [...new Set(codes)];
    for (const code of unique) {
      if (!SECURITY_RE.test(code)) {
        throw new ApiException('INVALID_ARGUMENT', 400, `证券代码格式须为 000002.XSHE: ${code}`);
      }
    }
    const startDash = toDashDate(start);
    const endDash = toDashDate(end);
    const all: QuoteRow[] = [];
    for (let i = 0; i < unique.length; i += CODE_CHUNK) {
      const chunk = unique.slice(i, i + CODE_CHUNK).map((code) => {
        const [ticker, exchange] = code.split('.');
        return { ticker, exchange };
      });
      const placeholders = chunk.map(() => '(?, ?)').join(', ');
      const params: (string | number)[] = [startDash, endDash];
      for (const c of chunk) params.push(c.ticker, c.exchange);
      const sql =
        `SELECT TICKER_SYMBOL, EXCHANGE_CD, TRADE_DATE, OPEN_PRICE_1, CLOSE_PRICE_1, PRE_CLOSE_PRICE_1 FROM \`${QUOTE_TABLE}\` ` +
        `WHERE TRADE_DATE BETWEEN ? AND ? AND CLOSE_PRICE_1 IS NOT NULL AND PRE_CLOSE_PRICE_1 IS NOT NULL ` +
        `AND (TICKER_SYMBOL, EXCHANGE_CD) IN (${placeholders}) ORDER BY TRADE_DATE`;
      const rows = await this.query(sql, params);
      for (const row of rows as Record<string, unknown>[]) {
        all.push({
          ticker: String(row.TICKER_SYMBOL),
          exchange: String(row.EXCHANGE_CD),
          tradeDate: String(row.TRADE_DATE),
          open: row.OPEN_PRICE_1 === null ? null : toNum(row.OPEN_PRICE_1),
          close: toNum(row.CLOSE_PRICE_1),
          preClose: toNum(row.PRE_CLOSE_PRICE_1),
        });
      }
    }
    this.logger.log(`${QUOTE_TABLE} 日线 ${start}~${end}: ${unique.length} 只，${all.length} 行`);
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

  /** 指数单字段区间序列（择时条件用）：键列为 TICKER_SYMBOL。
   *  内部 ID 键表（mkt_idxd_eval 等）接入见 TABLE_KEY_COLUMNS 设计（大盘择时重构方案 §3.1） */
  async readIndexFieldSeries(table: string, field: string, ticker: string, start: string, end: string): Promise<IndexFieldRow[]> {
    this.assertTable(table);
    this.assertField(table, field);
    this.assertRange(start, end);
    if (!/^\d{6}$/.test(ticker)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `指数代码格式须为 6 位数字（如 000001）: ${ticker}`);
    }
    const sql =
      `SELECT TRADE_DATE, \`${field}\` AS v FROM \`${table}\` ` +
      `WHERE TICKER_SYMBOL = ? AND TRADE_DATE BETWEEN ? AND ? AND \`${field}\` IS NOT NULL ORDER BY TRADE_DATE`;
    const rows = await this.query(sql, [ticker, toDashDate(start), toDashDate(end)]);
    return (rows as Record<string, unknown>[]).map((row) => ({
      tradeDate: String(row.TRADE_DATE),
      value: toNum(row.v),
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

  /** 静态表：字段字典里没有 TRADE_DATE 列（md_security 等主表）——截面/序列查询忽略日期条件 */
  private isStaticTable(table: string): boolean {
    return !(loadTableFields(table)?.has('TRADE_DATE') ?? false);
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

  /** codes 按 CODE_CHUNK 分片；null（全市场）原样返回单元素数组（不加 IN 条件） */
  private chunkCodes(codes: string[] | null): (string[] | null)[] {
    if (codes === null) return [null];
    if (!codes.length) return [];
    const out: string[][] = [];
    for (let i = 0; i < codes.length; i += CODE_CHUNK) out.push(codes.slice(i, i + CODE_CHUNK));
    return out;
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

  /** 唯一打库收口：白名单校验已在各方法先行，这里只负责 缓存 → 并发去重 → 连接池执行 */
  private async query(sql: string, params: (string | number)[]): Promise<unknown[]> {
    const key = sql + '§' + JSON.stringify(params);

    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      if (Date.now() - hit.at < CACHE_TTL_MS) {
        this.cache.set(key, hit); // 删了重插 = 移到队尾（最新），实现 LRU
        this.cacheHits++;
        this.logger.log(`缓存命中（累计 ${this.cacheHits}）: ${sql.slice(0, 72)}…`);
        return hit.rows;
      }
      // 已过期：不回插，走正常查询后以新结果覆盖
    }

    const running = this.inflight.get(key);
    if (running) return running; // 并发同查询：等待首个请求的结果，不重复打库

    const task = (async () => {
      try {
        const [rows] = await this.getPool().execute(sql, params);
        const out = rows as unknown[];
        this.cache.set(key, { at: Date.now(), rows: out });
        this.evictCacheOverflow();
        return out;
      } catch (error) {
        const msg = (error as Error).message.slice(0, 200);
        this.logger.error(`取数失败: ${msg}`);
        throw new ApiException('DATA_SOURCE_ERROR', 502, `MySQL 取数失败: ${msg}`);
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, task);
    return task;
  }

  /** 缓存超容淘汰：从最旧条目开始删（Map 队首），封顶防长驻进程内存膨胀 */
  private evictCacheOverflow(): void {
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
