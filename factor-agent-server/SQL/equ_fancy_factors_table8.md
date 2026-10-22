# equ_fancy_factors_table8（精品因子库数据表8）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》1.0_股票 / 2.0_A股精品因子库，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了精品因子库的21个因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 股票代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | CCR_Q | 季度现金流动负债比率 | decimal(20,4) | 是 |  |  |
| 5 | TOE_TTM_STD | 年度应纳税额稳定性 | decimal(20,4) | 是 |  |  |
| 6 | CFP_TTM_STD | 资本支出稳定性 | decimal(20,4) | 是 |  |  |
| 7 | GOVERNANCE | 公司治理 | decimal(20,4) | 是 |  |  |
| 8 | PROFIT_QQC | 盈利能力综合得分 | decimal(20,4) | 是 |  |  |
| 9 | GROWTH_QQC | 成长综合得分 | decimal(20,4) | 是 |  |  |
| 10 | OPERATION_QQC | 营运效率综合得分 | decimal(20,4) | 是 |  |  |
| 11 | Q_SCORE | 综合质量得分 | decimal(20,4) | 是 |  |  |
| 12 | CON_DTOP | 一致预期股息率 | decimal(20,4) | 是 |  |  |
| 13 | CON_DTOP_Z90 | 一致预期股息率90天标准化 | decimal(20,4) | 是 |  |  |
| 14 | CON_DTOP_Z180 | 一致预期股息率180天标准化 | decimal(20,4) | 是 |  |  |
| 15 | CON_DTOP_DA30 | 一致预期股息率30日变化率 | decimal(20,4) | 是 |  |  |
| 16 | CON_DTOP_DA90 | 一致预期股息率90日变化率 | decimal(20,4) | 是 |  |  |
| 17 | CON_DPR | 一致预期股利支付率 | decimal(20,4) | 是 |  |  |
| 18 | AI_DTOP | AI预测股息率 | decimal(20,4) | 是 |  |  |
| 19 | AI_DTOP_Z90 | AI预测股息率90天标准化 | decimal(20,4) | 是 |  |  |
| 20 | AI_DTOP_Z180 | AI预测股息率180天标准化 | decimal(20,4) | 是 |  |  |
| 21 | AI_DTOP_DA30 | AI预测股息率30日变化率 | decimal(20,4) | 是 |  |  |
| 22 | AI_DTOP_DA90 | AI预测股息率90日变化率 | decimal(20,4) | 是 |  |  |
| 23 | AI_DPR | AI预测股利支付率 | decimal(20,4) | 是 |  |  |
| 24 | QES | 季度业绩超预期幅度 | decimal(20,4) | 是 |  |  |
