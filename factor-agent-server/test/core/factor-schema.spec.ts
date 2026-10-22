import { listKnownTables, loadTableFields } from '../../src/core/factor-schema';
import { IDENT_RE } from '../../src/core/factor-data.service';

/* ==========================================================
   字段字典（SQL 目录）解析单元测试
   直接读取仓库内真实字典：tables.md 表清单 + <表名>.md 字段清单
   ========================================================== */

describe('factor-schema（SQL 字段字典解析）', () => {
  describe('listKnownTables（表名白名单）', () => {
    it('返回根目录字典与行业字典并集（27 张通联表 + 6 张行业表，idx_member 为池筛选消费表）', () => {
      expect(listKnownTables()).toEqual([
        'equ_factor_cf',
        'equ_factor_derive',
        'equ_factor_obos',
        'cb_factors_table1',
        'cb_factors_table2',
        'cb_factors_table3',
        'cb_factors_table4',
        'cb_factors_table5',
        'cb_factors_table6',
        'equ_fancy_factors_table1',
        'equ_fancy_factors_table2',
        'equ_fancy_factors_table3',
        'equ_fancy_factors_table4',
        'equ_fancy_factors_table5',
        'equ_fancy_factors_table6',
        'equ_fancy_factors_table7',
        'equ_fancy_factors_table8',
        'equ_fancy_factors_table9',
        'equ_fancy_factors_table10',
        'mkt_adjf',
        'mkt_equd_adj',
        'mkt_idxd',
        'md_security',
        'md_industry',
        'md_type',
        'md_type_description',
        'md_company_status',
        'sw_classify',
        'sw_member',
        'stock_industry',
        'dc_board_index',
        'dc_board_list',
        'idx_member',
      ]);
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

    it('mkt_equd_adj：字段清单含前复权收盘与定位列（等权回测数据源）', () => {
      const fields = loadTableFields('mkt_equd_adj')!;
      expect(fields.has('TICKER_SYMBOL')).toBe(true);
      expect(fields.has('EXCHANGE_CD')).toBe(true);
      expect(fields.has('TRADE_DATE')).toBe(true);
      expect(fields.has('CLOSE_PRICE_1')).toBe(true);
      expect(fields.has('ACCUM_ADJ_FACTOR')).toBe(true);
    });

    it('mkt_idxd：字段清单含指数收盘列（回测基准数据源）', () => {
      const fields = loadTableFields('mkt_idxd')!;
      expect(fields.has('TICKER_SYMBOL')).toBe(true);
      expect(fields.has('TRADE_DATE')).toBe(true);
      expect(fields.has('CLOSE_INDEX')).toBe(true);
      expect(fields.has('PRE_CLOSE_INDEX')).toBe(true);
    });

    it('equ_factor_obos：字段清单含系统列与超买超卖因子列', () => {
      const fields = loadTableFields('equ_factor_obos')!;
      expect(fields.has('SECURITY_ID')).toBe(true);
      expect(fields.has('TRADE_DATE')).toBe(true);
      expect(fields.has('REVS5')).toBe(true);
      expect(fields.has('RSI')).toBe(true);
      expect(fields.has('KDJ_J')).toBe(true);
      expect(fields.has('ILLIQUIDITY')).toBe(true);
    });

    it('cb_factors_table：字段清单含债券代码定位列与估值因子列（字典未提供字段描述）', () => {
      const fields = loadTableFields('cb_factors_table1')!;
      expect(fields.has('TICKER_SYMBOL')).toBe(true);
      expect(fields.has('TRADE_DATE')).toBe(true);
      expect(fields.has('BOND_VALUE')).toBe(true);
      expect(fields.has('RISK_PREM_Z120')).toBe(true);
      expect(fields.has('YEAR_TO_MAT')).toBe(true);
    });

    it('equ_fancy_factors_table：字段清单含股票代码定位列与精品因子列（字典未提供字段描述）', () => {
      const fields = loadTableFields('equ_fancy_factors_table1')!;
      expect(fields.has('TICKER_SYMBOL')).toBe(true);
      expect(fields.has('TRADE_DATE')).toBe(true);
      expect(fields.has('UDSL_DWL')).toBe(true);
      expect(fields.has('CORR_VP')).toBe(true);
      expect(fields.has('SUDE')).toBe(true);
    });

    it('各表字段数与字典一致（23 / 49 / 68 / 15 / 20 / 15）', () => {
      expect(loadTableFields('equ_factor_cf')!.size).toBe(23);
      expect(loadTableFields('equ_factor_derive')!.size).toBe(49);
      expect(loadTableFields('equ_factor_obos')!.size).toBe(68);
      expect(loadTableFields('mkt_adjf')!.size).toBe(15);
      expect(loadTableFields('mkt_equd_adj')!.size).toBe(20);
      expect(loadTableFields('mkt_idxd')!.size).toBe(15);
    });

    it('cb / fancy 两族 16 张表字段数与字典一致（33/25/33/23/33/35 与 23×6/24×2/25/27）', () => {
      const cb = [33, 25, 33, 23, 33, 35];
      cb.forEach((n, i) => expect(loadTableFields(`cb_factors_table${i + 1}`)!.size).toBe(n));
      const fancy = [23, 23, 23, 23, 23, 23, 24, 24, 25, 27];
      fancy.forEach((n, i) => expect(loadTableFields(`equ_fancy_factors_table${i + 1}`)!.size).toBe(n));
    });

    it('全部字段都是合法标识符（可安全反引号拼接）', () => {
      for (const table of listKnownTables()) {
        for (const f of loadTableFields(table)!) {
          expect(IDENT_RE.test(f)).toBe(true);
        }
      }
    });

    it('不在 tables.md 清单中的表返回 undefined', () => {
      expect(loadTableFields('no_such_table')).toBeUndefined();
      expect(loadTableFields('equ_factor_not_exist')).toBeUndefined();
    });
  });
});
