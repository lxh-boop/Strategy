# equ_fancy_factors_table2（精品因子库数据表2）因子字段描述

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
| 4 | ROE_Q | 季度净资产收益率 | decimal(20,4) | 是 |  |  |
| 5 | ROE_TTM | TTM净资产收益率 | decimal(20,4) | 是 |  |  |
| 6 | ROE_Q_YOYD | 季度净资产收益率同比差值 | decimal(20,4) | 是 |  |  |
| 7 | ROE_TTM_QOQD | TTM净资产收益率环比差值 | decimal(20,4) | 是 |  |  |
| 8 | ROE_TTM_YOYD | TTM净资产收益率同比差值 | decimal(20,4) | 是 |  |  |
| 9 | DTOP | 股息率TTM | decimal(20,4) | 是 |  |  |
| 10 | DIV_PAIDRATIO | 股息支付率TTM | decimal(20,4) | 是 |  |  |
| 11 | Q_ETOP | 季度市盈率倒数 | decimal(20,4) | 是 |  |  |
| 12 | Q_STOP | 季度市销率倒数 | decimal(20,4) | 是 |  |  |
| 13 | D_Q_ETOP | 季度归母净利润同比差值市值比 | decimal(20,4) | 是 |  |  |
| 14 | D_Q_STOP | 季度营收同比差值市值比 | decimal(20,4) | 是 |  |  |
| 15 | AI_SUDE | AI未预期归母净利润差值 | decimal(20,4) | 是 |  |  |
| 16 | CON_SUDE | 一致预期未预期归母净利润差值 | decimal(20,4) | 是 |  |  |
| 17 | AI_SUDREV | AI未预期营业收入差值 | decimal(20,4) | 是 |  |  |
| 18 | CON_SUDREV | 一致预期未预期营业收入差值 | decimal(20,4) | 是 |  |  |
| 19 | AI_NP_YOY | AI未来一年归母净利润增长率 | decimal(20,4) | 是 |  |  |
| 20 | AI_REV_YOY | AI未来一年营业收入增长率 | decimal(20,4) | 是 |  |  |
| 21 | CON_NP_YOY | 一致预期未来一年归母净利润增长率 | decimal(20,4) | 是 |  |  |
| 22 | CON_REV_YOY | 一致预期未来一年营业总收入增长率 | decimal(20,4) | 是 |  |  |
| 23 | AI_ETOP | AI预测市盈率倒数 | decimal(20,4) | 是 |  |  |
