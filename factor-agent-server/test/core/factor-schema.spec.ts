import { listKnownTables, loadTableFields } from '../../src/core/factor-schema';
import { IDENT_RE } from '../../src/core/factor-data.service';

/* ==========================================================
   字段字典（SQL 目录）解析单元测试
   直接读取仓库内真实字典：tables.md 表清单 + <表名>.md 字段清单
   ========================================================== */

describe('factor-schema（SQL 字段字典解析）', () => {
  describe('listKnownTables（表名白名单）', () => {
    it('返回 tables.md 中登记的三张表', () => {
      expect(listKnownTables()).toEqual(['equ_factor_cf', 'equ_factor_derive', 'mkt_adjf']);
    });
  });

  describe('loadTableFields（表字段白名单）', () => {
    it('equ_factor_cf：字段清单含系统列与现金流因子列', () => {
      const fields = loadTableFields('equ_factor_cf')!;
      expect(fields.has('SECURITY_ID')).toBe(true);
      expect(fields.has('TRADE_DATE')).toBe(true);
      expect(fields.has('OperCashGrowRate')).toBe(true);
      expect(fields.has('NetProfitCashCover')).toBe(true);
      expect(fields.has('CTOP')).toBe(true);
      expect(fields.has('NOCFToOperatingNILatest')).toBe(true);
    });

    it('equ_factor_derive：字段清单含衍生因子列', () => {
      const fields = loadTableFields('equ_factor_derive')!;
      expect(fields.has('EBIT')).toBe(true);
      expect(fields.has('EBITDA')).toBe(true);
      expect(fields.has('NetProfitTTM')).toBe(true);
      expect(fields.has('FCFF')).toBe(true);
    });

    it('mkt_adjf：字段清单含复权因子列', () => {
      const fields = loadTableFields('mkt_adjf')!;
      expect(fields.has('EX_DIV_DATE')).toBe(true);
      expect(fields.has('ADJ_FACTOR_1')).toBe(true);
      expect(fields.has('ACCUM_ADJ_FACTOR')).toBe(true);
      expect(fields.has('END_DATE')).toBe(true);
    });

    it('各表字段数与字典一致（23 / 49 / 15）', () => {
      expect(loadTableFields('equ_factor_cf')!.size).toBe(23);
      expect(loadTableFields('equ_factor_derive')!.size).toBe(49);
      expect(loadTableFields('mkt_adjf')!.size).toBe(15);
    });

    it('全部字段都是合法标识符（可安全反引号拼接）', () => {
      for (const table of listKnownTables()) {
        for (const f of loadTableFields(table)!) {
          expect(IDENT_RE.test(f)).toBe(true);
        }
      }
    });

    it('不在 tables.md 清单中的表返回 undefined', () => {
      expect(loadTableFields('md_security')).toBeUndefined();
      expect(loadTableFields('equ_factor_not_exist')).toBeUndefined();
    });
  });
});
