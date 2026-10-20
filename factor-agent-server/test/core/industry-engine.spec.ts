import {
  industryReadTable,
  resolveIndustrySecurities,
} from '../../src/core/industry-engine';

/* ==========================================================
   引擎 B（行业数据）集成测试：直连真实 DuckDB 库（由 SQL/industry CSV 建表，
   库文件 gitignore）。断言基于申万成分的稳定事实（茅台属食品饮料等）。
   ========================================================== */

describe('industry-engine（PIT 归属与查表）', () => {
  it('时点归属：600519 在 2024 年属食品饮料；食品饮料名单含茅台、不含平安银行', async () => {
    const { securities, unknown } = await resolveIndustrySecurities(['食品饮料'], 20240102);
    expect(unknown).toEqual([]);
    expect(securities).toContain('600519.XSHG');
    expect(securities).not.toContain('000001.XSHE');
  });

  it('PIT 历史归属：600681 在 2017-05-25 前属建筑装饰、之后不属于', async () => {
    const before = await resolveIndustrySecurities(['建筑装饰'], 20170524);
    const after = await resolveIndustrySecurities(['建筑装饰'], 20170526);
    expect(before.securities).toContain('600681.XSHG');
    expect(after.securities).not.toContain('600681.XSHG');
  });

  it('未识别行业单独返回 unknown（不污染已识别行业的解析）', async () => {
    const { securities, unknown } = await resolveIndustrySecurities(['食品饮料', '不存在行业'], 20240102);
    expect(unknown).toEqual(['不存在行业']);
    expect(securities).toContain('600519.XSHG');
  });

  it('industryReadTable：sw_classify 按字段读出 31 个一级行业', async () => {
    const rows = await industryReadTable({
      table: 'sw_classify',
      fields: ['index_code', 'industry_name', 'level'],
      date: '20240102',
      security: '',
    });
    const l1 = rows.filter((r) => r.level === 'L1');
    expect(l1.length).toBe(31);
    expect(l1.map((r) => r.industry_name)).toContain('食品饮料');
  });

  it('industryReadTable：sw_member 时点过滤（date 语义 = 当时在册）', async () => {
    const rows = await industryReadTable({
      table: 'sw_member',
      fields: ['ts_code', 'l1_name', 'in_date', 'out_date'],
      date: '20240102',
      security: '600681.SH',
    });
    // 600681 于 2017-05-25 调出建筑装饰后另有归属；时点过滤 = 当时在册的行（非原行业即通过）
    expect(rows.every((r) => r.l1_name !== '建筑装饰')).toBe(true);
  });
});
