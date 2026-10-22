# equ_fancy_factors_table4（精品因子库数据表4）因子字段描述

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
| 4 | FUND_TOP10_CHG_WEIGHT | 基金重仓股持仓权重变化 | decimal(20,4) | 是 |  |  |
| 5 | FUND_TOP10_CHG_VALUERAITO | 基金重仓股持仓市值比变化 | decimal(20,4) | 是 |  |  |
| 6 | P_REPORT_DATE | 定期财报预披露日 | decimal(20,4) | 是 |  |  |
| 7 | P_REPORT_DIFF | 定期财报预披露日变化 | decimal(20,4) | 是 |  |  |
| 8 | HK_HOLDVOL_CHG_B20 | 北向券商类资金20日持股数变化 | decimal(20,4) | 是 |  |  |
| 9 | HK_HOLDVOL_CHG_C20 | 北向银行类资金20日持股数变化 | decimal(20,4) | 是 |  |  |
| 10 | HK_HOLDVOL_CHG_ALL20 | 北向资金20日持股数变化 | decimal(20,4) | 是 |  |  |
| 11 | HK_HOLDVOL_CHG_B60 | 北向券商类资金60日持股数变化 | decimal(20,4) | 是 |  |  |
| 12 | HK_HOLDVOL_CHG_C60 | 北向银行类资金60日持股数变化 | decimal(20,4) | 是 |  |  |
| 13 | HK_HOLDVOL_CHG_ALL60 | 北向资金60日持股数变化 | decimal(20,4) | 是 |  |  |
| 14 | HK_HOLDVOL_CHG_B120 | 北向券商类资金120日持股数变化 | decimal(20,4) | 是 |  |  |
| 15 | HK_HOLDVOL_CHG_C120 | 北向银行类资金120日持股数变化 | decimal(20,4) | 是 |  |  |
| 16 | HK_HOLDVOL_CHG_ALL120 | 北向资金120日持股数变化 | decimal(20,4) | 是 |  |  |
| 17 | AI_DA_NP_30 | AI归母净利润30日变化 | decimal(20,4) | 是 |  |  |
| 18 | AI_DA_NP_60 | AI归母净利润60日变化 | decimal(20,4) | 是 |  |  |
| 19 | AI_DA_NP_90 | AI归母净利润90日变化 | decimal(20,4) | 是 |  |  |
| 20 | AI_DA_REV_30 | AI营业收入30日变化 | decimal(20,4) | 是 |  |  |
| 21 | AI_DA_REV_60 | AI营业收入60日变化 | decimal(20,4) | 是 |  |  |
| 22 | AI_DA_REV_90 | AI营业收入90日变化 | decimal(20,4) | 是 |  |  |
| 23 | AI_DA_PE_30 | AI市盈率30日变化 | decimal(20,4) | 是 |  |  |
