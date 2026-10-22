# cb_factors_table1（可转债因子库数据表1）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》4.0_可转债，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了可转债因子库的30个可转债估值因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 债券代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | BOND_VALUE | 纯债价值 | decimal(20,8) | 是 |  |  |
| 5 | RISK_PREM | 纯债溢价率 | decimal(20,8) | 是 |  |  |
| 6 | RISK_PREM_Z120 | 纯债溢价率的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 7 | RISK_PREM_Z240 | 纯债溢价率的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 8 | YEAR_TO_MAT | 剩余到期时间 | decimal(20,8) | 是 |  |  |
| 9 | CLOSE_PRICE | 绝对价格 | decimal(20,8) | 是 |  |  |
| 10 | CLOSE_PRICE_Z120 | 绝对价格的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 11 | CLOSE_PRICE_Z240 | 绝对价格的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 12 | IV | 隐含波动率 | decimal(20,8) | 是 |  |  |
| 13 | IV_Z120 | 隐波的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 14 | IV_Z240 | 隐波的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 15 | IV_DIFF | 隐波差 | decimal(20,8) | 是 |  |  |
| 16 | IV_DIFF_Z120 | 隐波差的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 17 | IV_DIFF_Z240 | 隐波差的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 18 | PARITY | 平价 | decimal(20,8) | 是 |  |  |
| 19 | PAR_PREM | 平价底价溢价率 | decimal(20,8) | 是 |  |  |
| 20 | PAR_PREM_Z120 | 平价底价溢价率的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 21 | PAR_PREM_Z240 | 平价底价溢价率的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 22 | CONV_PREM | 转股溢价率 | decimal(20,8) | 是 |  |  |
| 23 | CONV_PREM_Z120 | 转股溢价率的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 24 | CONV_PREM_Z240 | 转股溢价率的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 25 | DOUBLE_LOW | 双低 | decimal(20,8) | 是 |  |  |
| 26 | DOUBLE_LOW_Z120 | 双低的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 27 | DOUBLE_LOW_Z240 | 双低的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 28 | BS_BIAS | BS定价偏离度 | decimal(20,8) | 是 |  |  |
| 29 | BS_BIAS_Z120 | BS定价偏离度的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 30 | BS_BIAS_Z240 | BS定价偏离度的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 31 | BINOMIAL_TREE_BIAS | 二叉树定价偏离度 | decimal(20,8) | 是 |  |  |
| 32 | BINOMIAL_TREE_BIAS_Z120 | 二叉树定价偏离度的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 33 | BINOMIAL_TREE_BIAS_Z240 | 二叉树定价偏离度的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
