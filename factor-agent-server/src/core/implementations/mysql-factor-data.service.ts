import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, Pool } from 'mysql2/promise';
import { ApiException } from '../../common/api.exception';
import { loadTableFields, listKnownTables } from '../factor-schema';
import {
  DATE_RE,
  FactorDataService,
  FactorDataRow,
  FactorTableQuery,
  IDENT_RE,
  SECURITY_RE,
} from '../factor-data.service';

/* ==========================================================
   因子数据读取实现：MySQL（mysql2 连接池）
   - 表名/字段名只允许 [A-Za-z0-9_] 且反引号包裹，日期/证券代码走参数占位符，杜绝注入
   - 连接池按配置懒创建：.env 未配齐时不阻塞启动，首次取数时给出明确报错
   ========================================================== */

/** 单次查询允许的最大因子字段数（防止拼接超长 SQL） */
const MAX_FIELDS = 200;

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
