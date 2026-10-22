# cb_factors_table2（可转债因子库数据表2）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》4.0_可转债，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了可转债因子库的22个可转债日线量价因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 债券代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | CHG_PCT_5D | 转债近5日涨跌幅均值 | decimal(20,8) | 是 |  |  |
| 5 | CHG_PCT_10D | 转债近10日涨跌幅均值 | decimal(20,8) | 是 |  |  |
| 6 | CHG_PCT_20D | 转债近20日涨跌幅均值 | decimal(20,8) | 是 |  |  |
| 7 | CHG_PCT_60D | 转债近60日涨跌幅均值 | decimal(20,8) | 是 |  |  |
| 8 | CHG_PCT_120D | 转债近120日涨跌幅均值 | decimal(20,8) | 是 |  |  |
| 9 | CHG_PCT_240D | 转债近240日涨跌幅均值 | decimal(20,8) | 是 |  |  |
| 10 | TURNOVER_RATE_5D | 转债近5日换手率均值 | decimal(20,8) | 是 |  |  |
| 11 | TURNOVER_RATE_10D | 转债近10日换手率均值 | decimal(20,8) | 是 |  |  |
| 12 | TURNOVER_RATE_20D | 转债近20日换手率均值 | decimal(20,8) | 是 |  |  |
| 13 | TURNOVER_RATE_60D | 转债近60日换手率均值 | decimal(20,8) | 是 |  |  |
| 14 | TURNOVER_RATE_120D | 转债近120日换手率均值 | decimal(20,8) | 是 |  |  |
| 15 | TURNOVER_RATE_240D | 转债近240日换手率均值 | decimal(20,8) | 是 |  |  |
| 16 | PRICE_SKEW_20D | 近20日价格偏度 | decimal(20,8) | 是 |  |  |
| 17 | PRICE_SKEW_60D | 近60日价格偏度 | decimal(20,8) | 是 |  |  |
| 18 | PRICE_SKEW_120D | 近120日价格偏度 | decimal(20,8) | 是 |  |  |
| 19 | PRICE_SKEW_240D | 近240日价格偏度 | decimal(20,8) | 是 |  |  |
| 20 | AMPLITUDE | 振幅 | decimal(20,8) | 是 |  |  |
| 21 | AMPLITUDE_Z120 | 振幅的6M时序SCORE | decimal(20,8) | 是 |  |  |
| 22 | AMPLITUDE_Z240 | 振幅的1Y时序SCORE | decimal(20,8) | 是 |  |  |
| 23 | AMP_DIFF | 振幅差 | decimal(20,8) | 是 |  |  |
| 24 | AMP_DIFF_Z120 | 振幅差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 25 | AMP_DIFF_Z240 | 振幅差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
