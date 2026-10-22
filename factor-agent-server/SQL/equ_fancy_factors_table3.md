# equ_fancy_factors_table3（精品因子库数据表3）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》1.0_股票 / 2.0_A股精品因子库，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了精品因子库的20个因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 股票交易代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | AI_ETOP_Z90 | AI预测市盈率倒数90天标准化 | decimal(20,4) | 是 |  |  |
| 5 | AI_ETOP_Z180 | AI预测市盈率倒数180天标准化 | decimal(20,4) | 是 |  |  |
| 6 | CON_DA_PE_20 | 一致预期PE20日变化率 | decimal(20,4) | 是 |  |  |
| 7 | CON_DA_PE_40 | 一致预期PE40日变化率 | decimal(20,4) | 是 |  |  |
| 8 | CON_DA_PE_60 | 一致预期PE60日变化率 | decimal(20,4) | 是 |  |  |
| 9 | CON_DA_PS_20 | 一致预期PS20日变化率 | decimal(20,4) | 是 |  |  |
| 10 | CON_DA_PS_40 | 一致预期PS40日变化率 | decimal(20,4) | 是 |  |  |
| 11 | CON_DA_PS_60 | 一致预期PS60日变化率 | decimal(20,4) | 是 |  |  |
| 12 | AST_DA12_ETOP | 分析师净利润调整市值比 | decimal(20,4) | 是 |  |  |
| 13 | AST_RANK_UPPCT | 分析师评级上调比例 | decimal(20,4) | 是 |  |  |
| 14 | AST_PROFIT_UPPCT | 分析师净利润上涨比例 | decimal(20,4) | 是 |  |  |
| 15 | GSA | 月度券商金股推荐机构数 | decimal(20,4) | 是 |  |  |
| 16 | HK_HOLDRATIO_ALL | 北向资金持股比例 | decimal(20,4) | 是 |  |  |
| 17 | HK_HOLDRATIO_B | 北向券商类资金持股比例 | decimal(20,4) | 是 |  |  |
| 18 | HK_HOLDRATIO_C | 北向银行类资金持股比例 | decimal(20,4) | 是 |  |  |
| 19 | FUND_TOP10_COUNT | 重仓基金个数 | decimal(20,4) | 是 |  |  |
| 20 | FUND_TOP10_WEIGHT_MEAN | 基金重仓股权重均值 | decimal(20,4) | 是 |  |  |
| 21 | FUND_TOP10_WEIGHT_MAX | 基金重仓股权重最大值 | decimal(20,4) | 是 |  |  |
| 22 | FUND_TOP10_NEGVALUE_PCT | 基金重仓股持仓市值比 | decimal(20,4) | 是 |  |  |
| 23 | NAIVE_WEIGHT_CHANGE_ASYM | 基金重仓股变化不对称和 | decimal(20,4) | 是 |  |  |
