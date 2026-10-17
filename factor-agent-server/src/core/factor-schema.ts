import { readFileSync } from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { IDENT_RE } from './factor-data.service';

/* ==========================================================
   字段字典（<项目根>/SQL 目录）按需解析：
   - tables.md：表名白名单（`## 表名（中文名）` 标题）
   - <表名>.md：该表的字段白名单（字段表格第二列）
   每次取数只现读当前查询涉及的一两个小文件（几 KB，微秒级），
   不做全局预解析、不占缓存；文档改动天然即时生效。
   ========================================================== */

/** 字段字典目录：<项目根>/SQL（dist/core 编译产物向上两级） */
const SQL_DIR = path.resolve(__dirname, '..', '..', 'SQL');

/** 表清单文档：表名白名单来源 */
const TABLES_DOC = 'tables.md';

const logger = new Logger('FactorSchema');

/** tables.md 里的表名行：`## 表名（中文名）` */
const TABLE_HEADING_RE = /^##\s+([A-Za-z_][A-Za-z0-9_]*)/;

/** 字段字典里的字段行：`| 6 | TotalFixedAssets | 固定资产合计 | ...`（取第 2 列字段名） */
const FIELD_ROW_RE = /^\|\s*\d+\s*\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|/;

function readLines(file: string): string[] {
  return readFileSync(path.join(SQL_DIR, file), 'utf-8').split(/\r?\n/);
}

/** tables.md 中的表名清单（现读，主要用于报错时提示可用表） */
export function listKnownTables(): string[] {
  try {
    const names: string[] = [];
    for (const line of readLines(TABLES_DOC)) {
      const m = TABLE_HEADING_RE.exec(line);
      if (m && IDENT_RE.test(m[1])) names.push(m[1]);
    }
    return names;
  } catch (error) {
    logger.warn(`表清单不可读（${(error as Error).message.slice(0, 120)}）: ${path.join(SQL_DIR, TABLES_DOC)}`);
    return [];
  }
}

/** 指定表的字段白名单：现读 SQL/<表名>.md 按需解析，不缓存。
 *  返回 undefined = 表不在 tables.md 清单里；空 Set = 清单里有但字典文件缺失（任何指名字段都不通过）。 */
export function loadTableFields(table: string): Set<string> | undefined {
  if (!listKnownTables().includes(table)) return undefined;
  const fields = new Set<string>();
  try {
    for (const line of readLines(`${table}.md`)) {
      const m = FIELD_ROW_RE.exec(line);
      if (m) fields.add(m[1]);
    }
  } catch (error) {
    logger.warn(`表 ${table} 的字段字典缺失（SQL/${table}.md）: ${(error as Error).message.slice(0, 120)}`);
  }
  return fields;
}

/** 字典白名单校验：每个引用的表必须在 SQL/tables.md，字段必须在该表 SQL/<表名>.md。
 *  确认门与两引擎共用此唯一实现（原模型 Ⅰ/Ⅱ 各有一份逐字副本）。 */
export function assertWhitelist(refs: { table: string; field: string }[]): void {
  for (const ref of refs) {
    const fields = loadTableFields(ref.table);
    if (fields === undefined) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `表不在字段字典中（SQL/tables.md）: ${ref.table}。可用表: ${listKnownTables().join(', ') || '（无）'}`,
      );
    }
    if (!fields.has(ref.field)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `表 ${ref.table} 无此因子字段（见 SQL/${ref.table}.md）: ${ref.field}`);
    }
  }
}

/* ----- 供智能体工具使用的富信息加载（同源解析，多带中文名/描述等） ----- */

/** 字段字典表格里的一行（供模型选因子用） */
export interface FactorFieldInfo {
  name: string;
  chinese: string;
  type: string;
  nullable: string;
  description: string;
}

/** tables.md 里的一个表条目（供模型挑表用） */
export interface FactorTableInfo {
  table: string;
  title: string;
  description: string;
  uniqueKey: string;
}

/** 表目录：tables.md 全部条目（`## 表名（中文名）` + `- 描述 :` / `- 唯一键 :`） */
export function loadTableCatalog(): FactorTableInfo[] {
  const catalog: FactorTableInfo[] = [];
  try {
    let current: FactorTableInfo | null = null;
    for (const line of readLines(TABLES_DOC)) {
      const heading = /^##\s+([A-Za-z_][A-Za-z0-9_]*)\s*（(.*)）/.exec(line);
      if (heading) {
        current = { table: heading[1], title: heading[2].trim(), description: '', uniqueKey: '' };
        catalog.push(current);
        continue;
      }
      if (!current) continue;
      const desc = /^-\s*描述\s*:\s*(.*)$/.exec(line);
      if (desc) current.description = desc[1].trim();
      const key = /^-\s*唯一键\s*:\s*(.*)$/.exec(line);
      if (key) current.uniqueKey = key[1].trim();
    }
  } catch (error) {
    logger.warn(`表清单不可读（${(error as Error).message.slice(0, 120)}）: ${path.join(SQL_DIR, TABLES_DOC)}`);
  }
  return catalog;
}

/** 指定表的字段明细（字段行第 3~6 列：中文名/类型/可空/描述）。
 *  返回 undefined = 表不在 tables.md 清单里；空数组 = 字典文件缺失。 */
export function loadTableFieldDetails(table: string): FactorFieldInfo[] | undefined {
  if (!listKnownTables().includes(table)) return undefined;
  const fields: FactorFieldInfo[] = [];
  try {
    for (const line of readLines(`${table}.md`)) {
      if (!FIELD_ROW_RE.test(line)) continue;
      const cells = line.split('|').map((c) => c.trim());
      // | 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 | → split 后首尾为空串
      if (cells.length < 7) continue;
      fields.push({
        name: cells[2],
        chinese: cells[3],
        type: cells[4],
        nullable: cells[5],
        description: cells[6],
      });
    }
  } catch (error) {
    logger.warn(`表 ${table} 的字段字典缺失（SQL/${table}.md）: ${(error as Error).message.slice(0, 120)}`);
  }
  return fields;
}
