# cb_factors_table3（可转债因子库数据表3）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》4.0_可转债，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了可转债因子库的30个正股转债结合日线量价因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 债券代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | CHG_DIFF_5D | 近5日转债正股涨跌幅之差均值 | decimal(20,8) | 是 |  |  |
| 5 | CHG_DIFF_10D | 近10日转债正股涨跌幅之差均值 | decimal(20,8) | 是 |  |  |
| 6 | CHG_DIFF_20D | 近20日转债正股涨跌幅之差均值 | decimal(20,8) | 是 |  |  |
| 7 | CHG_DIFF_60D | 近60日转债正股涨跌幅之差均值 | decimal(20,8) | 是 |  |  |
| 8 | CHG_DIFF_120D | 近120日转债正股涨跌幅之差均值 | decimal(20,8) | 是 |  |  |
| 9 | CHG_DIFF_240D | 近240日转债正股涨跌幅之差均值 | decimal(20,8) | 是 |  |  |
| 10 | CHG_DIFF_5D_Z120 | 近5日转债正股涨跌幅之差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 11 | CHG_DIFF_10D_Z120 | 近10日转债正股涨跌幅之差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 12 | CHG_DIFF_20D_Z120 | 近20日转债正股涨跌幅之差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 13 | CHG_DIFF_60D_Z120 | 近60日转债正股涨跌幅之差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 14 | CHG_DIFF_120D_Z120 | 近120日转债正股涨跌幅之差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 15 | CHG_DIFF_240D_Z120 | 近240日转债正股涨跌幅之差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 16 | CHG_DIFF_5D_Z240 | 近5日转债正股涨跌幅之差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 17 | CHG_DIFF_10D_Z240 | 近10日转债正股涨跌幅之差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 18 | CHG_DIFF_20D_Z240 | 近20日转债正股涨跌幅之差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 19 | CHG_DIFF_60D_Z240 | 近60日转债正股涨跌幅之差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 20 | CHG_DIFF_120D_Z240 | 近120日转债正股涨跌幅之差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 21 | CHG_DIFF_240D_Z240 | 近240日转债正股涨跌幅之差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 22 | CHG_CORR_20D | 转债和正股近20日涨跌幅相关系数 | decimal(20,8) | 是 |  |  |
| 23 | CHG_CORR_60D | 转债和正股近60日涨跌幅相关系数 | decimal(20,8) | 是 |  |  |
| 24 | CHG_CORR_120D | 转债和正股近120日涨跌幅相关系数 | decimal(20,8) | 是 |  |  |
| 25 | CHG_CORR_240D | 转债和正股近240日涨跌幅相关系数 | decimal(20,8) | 是 |  |  |
| 26 | CHG_CORR_20D_Z120 | 转债和正股近20日涨跌幅相关系数的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 27 | CHG_CORR_60D_Z120 | 转债和正股近60日涨跌幅相关系数的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 28 | CHG_CORR_120D_Z120 | 转债和正股近120日涨跌幅相关系数的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 29 | CHG_CORR_240D_Z120 | 转债和正股近240日涨跌幅相关系数的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 30 | CHG_CORR_20D_Z240 | 转债和正股近20日涨跌幅相关系数的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 31 | CHG_CORR_60D_Z240 | 转债和正股近60日涨跌幅相关系数的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 32 | CHG_CORR_120D_Z240 | 转债和正股近120日涨跌幅相关系数的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 33 | CHG_CORR_240D_Z240 | 转债和正股近240日涨跌幅相关系数的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
