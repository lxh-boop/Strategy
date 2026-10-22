# equ_fancy_factors_table1（精品因子库数据表1）因子字段描述

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
| 4 | UDSL_DWL | 威廉下影线 | decimal(20,4) | 是 |  |  |
| 5 | UDSL_UCL | 蜡烛上影线 | decimal(20,4) | 是 |  |  |
| 6 | UDSL | 上下影线 | decimal(20,4) | 是 |  |  |
| 7 | ASHAREHOLDER_Z | 股东数据时序标准分 | decimal(20,4) | 是 |  |  |
| 8 | TA_ENTROPY | 成交额占比熵 | decimal(20,4) | 是 |  |  |
| 9 | CORR_VP | 量先价后相关性 | decimal(20,4) | 是 |  |  |
| 10 | APB_SKEW | 高位成交的加权偏度 | decimal(20,4) | 是 |  |  |
| 11 | SUDE | 未预期季度归母净利润差值 | decimal(20,4) | 是 |  |  |
| 12 | SUDREV | 未预期季度营业总收入差值 | decimal(20,4) | 是 |  |  |
| 13 | LPNP_Q | 净利润提纯 | decimal(20,4) | 是 |  |  |
| 14 | NP_Q_YOY | 季度归母净利润同比 | decimal(20,4) | 是 |  |  |
| 15 | NP_YTD_YOY | 累计归母净利润同比 | decimal(20,4) | 是 |  |  |
| 16 | NP_TTM_QOQ | TTM归母净利润环比 | decimal(20,4) | 是 |  |  |
| 17 | NP_TTM_YOY | TTM归母净利润同比 | decimal(20,4) | 是 |  |  |
| 18 | REV_Q_YOY | 季度营业总收入同比 | decimal(20,4) | 是 |  |  |
| 19 | REV_YTD_YOY | 累计营业总收入同比 | decimal(20,4) | 是 |  |  |
| 20 | REV_TTM_QOQ | TTM营业总收入环比 | decimal(20,4) | 是 |  |  |
| 21 | REV_TTM_YOY | TTM营业总收入同比 | decimal(20,4) | 是 |  |  |
| 22 | RROC_Q | 营业能力改善 | decimal(20,4) | 是 |  |  |
| 23 | OCFA | 产能利用率提升 | decimal(20,4) | 是 |  |  |
