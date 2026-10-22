# cb_factors_table6（可转债因子库数据表6）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》4.0_可转债，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了可转债因子库的32个可转债估值因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 债券代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | MONTE_CARLO_BIAS | 蒙特卡洛模拟定价偏离度 | decimal(20,8) | 是 |  |  |
| 5 | MC_BIAS_Z120 | 蒙特卡洛模拟定价偏离度的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 6 | MC_BIAS_Z240 | 蒙特卡洛模拟定价偏离度的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 7 | IV_MC | 隐含波动率(蒙特卡洛模拟) | decimal(20,8) | 是 |  |  |
| 8 | IV_MC_DIFF | 隐波差(蒙特卡洛模拟) | decimal(20,8) | 是 |  |  |
| 9 | IV_MC_DIFF_Z120 | 隐波差(蒙特卡洛模拟)的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 10 | IV_MC_DIFF_Z240 | 隐波差(蒙特卡洛模拟)的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 11 | IV_BT | 隐含波动率(二叉树) | decimal(20,8) | 是 |  |  |
| 12 | IV_BT_DIFF | 隐波差(二叉树) | decimal(20,8) | 是 |  |  |
| 13 | IV_BT_DIFF_Z120 | 隐波差(二叉树)的6M时序ZSCORE | decimal(20,8) | 是 |  |  |
| 14 | IV_BT_DIFF_Z240 | 隐波差(二叉树)的1Y时序ZSCORE | decimal(20,8) | 是 |  |  |
| 15 | DELTA_BS | 转债价格对正股价格的偏导(BS) | decimal(20,8) | 是 |  |  |
| 16 | GAMMA_BS | 转债价格对正股价格的二阶偏导(BS) | decimal(20,8) | 是 |  |  |
| 17 | THETA_BS | 转债价格对时间的偏导(BS) | decimal(20,8) | 是 |  |  |
| 18 | VEGA_BS | 转债价格对正股波动率的偏导(BS) | decimal(20,8) | 是 |  |  |
| 19 | RHO_BS | 转债价格对利率的偏导(BS) | decimal(20,8) | 是 |  |  |
| 20 | DELTA_BT | 转债价格对正股价格的偏导(二叉树) | decimal(20,8) | 是 |  |  |
| 21 | GAMMA_BT | 转债价格对正股价格的二阶偏导(二叉树) | decimal(20,8) | 是 |  |  |
| 22 | THETA_BT | 转债价格对时间的偏导(二叉树) | decimal(20,8) | 是 |  |  |
| 23 | VEGA_BT | 转债价格对正股波动率的偏导(二叉树) | decimal(20,8) | 是 |  |  |
| 24 | DELTA_MC | 转债价格对正股价格的偏导(蒙特卡洛模拟) | decimal(20,8) | 是 |  |  |
| 25 | GAMMA_MC | 转债价格对正股价格的二阶偏导(蒙特卡洛模拟) | decimal(20,8) | 是 |  |  |
| 26 | THETA_MC | 转债价格对时间的偏导(蒙特卡洛模拟) | decimal(20,8) | 是 |  |  |
| 27 | VEGA_MC | 转债价格对正股波动率的偏导(蒙特卡洛模拟) | decimal(20,8) | 是 |  |  |
| 28 | ALPHA_L | 长期ALPHA | decimal(20,8) | 是 |  |  |
| 29 | ALPHA_S | 短期ALPHA | decimal(20,8) | 是 |  |  |
| 30 | BETA_EQU_L | 长期正股收益率BETA | decimal(20,8) | 是 |  |  |
| 31 | BETA_EQU_S | 短期正股收益率BETA | decimal(20,8) | 是 |  |  |
| 32 | BETA_CP_L | 长期转股溢价率风格BETA | decimal(20,8) | 是 |  |  |
| 33 | BETA_CP_S | 短期转股溢价率风格BETA | decimal(20,8) | 是 |  |  |
| 34 | BETA_CLOSE_L | 长期低价风格BETA | decimal(20,8) | 是 |  |  |
| 35 | BETA_CLOSE_S | 短期低价风格BETA | decimal(20,8) | 是 |  |  |
