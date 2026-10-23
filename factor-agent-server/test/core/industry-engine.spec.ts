import {
  industryFieldValues,
  industryReadTable,
  resolveFieldSecurities,
} from '../../src/core/industry-engine';

/* ==========================================================
   引擎 B（行业数据）集成测试：直连真实 DuckDB 库（由 SQL/industry CSV 建表，
   库文件 gitignore）。断言基于申万成分的稳定事实（茅台属食品饮料/白酒等）。
   字段化后（ADR-0011）：粒度由字段名承载，一/二级行业同一条 resolveFieldSecurities 通路。
   ========================================================== */

describe('industry-engine（字段值 PIT 归属与查表）', () => {
  it('时点归属：l1_name=食品饮料 2024 年含茅台、不含平安银行', async () => {
    const { securities, unknown } = await resolveFieldSecurities('sw_member', 'l1_name', ['食品饮料'], 20240102);
    expect(unknown).toEqual([]);
    expect(securities).toContain('600519.XSHG');
    expect(securities).not.toContain('000001.XSHE');
  });

  it('PIT 历史归属：600681 在 2017-05-25 前属建筑装饰、之后不属于', async () => {
    const before = await resolveFieldSecurities('sw_member', 'l1_name', ['建筑装饰'], 20170524);
    const after = await resolveFieldSecurities('sw_member', 'l1_name', ['建筑装饰'], 20170526);
    expect(before.securities).toContain('600681.XSHG');
    expect(after.securities).not.toContain('600681.XSHG');
  });

  it('二级行业同通路即刻可用：l2_name 精确值是"白酒Ⅱ"（非"白酒"，去重读才查得到）含茅台；未命中值单独返回 unknown', async () => {
    const { securities, unknown } = await resolveFieldSecurities('sw_member', 'l2_name', ['白酒Ⅱ', '不存在行业'], 20240102);
    expect(unknown).toEqual(['不存在行业']);
    expect(securities).toContain('600519.XSHG');
  });

  it('注册制闸门：未注册表 → 400；不存在字段 → 400 指路 list_factor_fields', async () => {
    await expect(resolveFieldSecurities('equ_factor_derive', 'l1_name', ['食品饮料'], 20240102)).rejects.toThrow(/未注册/);
    await expect(resolveFieldSecurities('sw_member', '不存在的列', ['白酒'], 20240102)).rejects.toThrow(/list_factor_fields/);
  });

  it('值发现：l2_name 全集含"白酒Ⅱ"；keyword 收窄只剩名称含白酒的值（含"非白酒"）', async () => {
    const all = await industryFieldValues('sw_member', 'l2_name');
    expect(all.truncated).toBe(false);
    expect(all.values).toContain('白酒Ⅱ');
    const narrowed = await industryFieldValues('sw_member', 'l2_name', '白酒');
    expect(narrowed.values).toContain('白酒Ⅱ');
    expect(narrowed.values).toContain('非白酒');
    expect(narrowed.values.length).toBe(2);
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
