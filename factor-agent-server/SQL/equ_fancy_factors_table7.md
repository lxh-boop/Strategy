# equ_fancy_factors_table7（精品因子库数据表7）因子字段描述

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
| 4 | FUND_TRACTION_20 | 20日基金持仓关联网络牵引力 | decimal(20,4) | 是 |  |  |
| 5 | FUND_TRACTION_60 | 60日基金持仓关联网络牵引力 | decimal(20,4) | 是 |  |  |
| 6 | SUR_EVENT | 机构调研场数 | decimal(20,4) | 是 |  |  |
| 7 | SUR_INST | 调研机构数量 | decimal(20,4) | 是 |  |  |
| 8 | GB_POST_NUM_30 | 过去30天股吧发帖数 | decimal(20,4) | 是 |  |  |
| 9 | GB_POST_NUM_60 | 过去60天股吧发帖数 | decimal(20,4) | 是 |  |  |
| 10 | GB_POST_NUM_90 | 过去90天股吧发帖数 | decimal(20,4) | 是 |  |  |
| 11 | GB_POST_NUM_DA30 | 过去30天股吧发帖数变化 | decimal(20,4) | 是 |  |  |
| 12 | T_ACCR_IS | 总应计盈余（利润表） | decimal(20,4) | 是 |  |  |
| 13 | D_ACCR_IS | 操纵性总应计盈余（利润表） | decimal(20,4) | 是 |  |  |
| 14 | T_ACCR_BS | 总应计盈余（资产负债表） | decimal(20,4) | 是 |  |  |
| 15 | D_ACCR_BS | 操纵性总应计盈余（资产负债表） | decimal(20,4) | 是 |  |  |
| 16 | NP_Q_ACC | 归母净利润加速度 | decimal(20,4) | 是 |  |  |
| 17 | REV_Q_ACC | 营业总收入加速度 | decimal(20,4) | 是 |  |  |
| 18 | NP_Q_SD | 归母净利润稳健加速度 | decimal(20,4) | 是 |  |  |
| 19 | OP_Q_SD | 营业利润稳健加速度 | decimal(20,4) | 是 |  |  |
| 20 | REV_Q_SD | 营业总收入稳健加速度 | decimal(20,4) | 是 |  |  |
| 21 | ROIC_Q | 季度投入资本收益率 | decimal(20,4) | 是 |  |  |
| 22 | CFOA_Q | 季度经营现金流比率 | decimal(20,4) | 是 |  |  |
| 23 | PROFIT_TREND | 业绩趋势 | decimal(20,4) | 是 |  |  |
| 24 | AT_TTM_QOQD | TTM总资产周转率环比差值 | decimal(20,4) | 是 |  |  |
