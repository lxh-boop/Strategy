# equ_fancy_factors_table10（精品因子库数据表10）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》1.0_股票 / 2.0_A股精品因子库，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了精品因子库的24个因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 股票代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | GR_PE_TTM | 高斯秩变换TTM市盈率 | decimal(20,4) | 是 |  |  |
| 5 | GR_PE_Q | 高斯秩变换季度市盈率 | decimal(20,4) | 是 |  |  |
| 6 | GR_PB | 高斯秩变换市净率 | decimal(20,4) | 是 |  |  |
| 7 | GR_PCF_TTM | 高斯秩变换TTM市现率 | decimal(20,4) | 是 |  |  |
| 8 | GR_PCF_Q | 高斯秩变换季度市现率 | decimal(20,4) | 是 |  |  |
| 9 | GR_PS_TTM | 高斯秩变换TTM市销率 | decimal(20,4) | 是 |  |  |
| 10 | GR_PS_Q | 高斯秩变换季度市销率 | decimal(20,4) | 是 |  |  |
| 11 | DEP_ABR_RATIO | 境外货币占货币资金比 | decimal(20,4) | 是 |  |  |
| 12 | TRANS_RATIO | 运输工具占固定资产比 | decimal(20,4) | 是 |  |  |
| 13 | CREDIT_DEBT_RATIO | 信用借款占比 | decimal(20,4) | 是 |  |  |
| 14 | FOREX_RATIO | 汇兑收益占财务费用比 | decimal(20,4) | 是 |  |  |
| 15 | STATIC_NOTE_RATIO | 财务附注合成因子 | decimal(20,4) | 是 |  |  |
| 16 | ABS_GPG_Q | 异常毛利增长 | decimal(20,4) | 是 |  |  |
| 17 | ABS_INVG | 异常存货增长 | decimal(20,4) | 是 |  |  |
| 18 | KCI | 知识资本强度 | decimal(20,4) | 是 |  |  |
| 19 | DTOA_YOYD | 资产负债率同比增量 | decimal(20,4) | 是 |  |  |
| 20 | IT_Q_YOYD | 季度存货周转率同比差值 | decimal(20,4) | 是 |  |  |
| 21 | IT_TTM_QOQD | TTM存货周转率环比差值 | decimal(20,4) | 是 |  |  |
| 22 | ART_Q_YOYD | 季度净应收额周转率同比差值 | decimal(20,4) | 是 |  |  |
| 23 | FAT_Q_YOYD | 季度固定资产周转率同比差值 | decimal(20,4) | 是 |  |  |
| 24 | FAT_TTM_QOQD | TTM固定资产周转率环比差值 | decimal(20,4) | 是 |  |  |
| 25 | OPER_L_YOY | 经营性流动负债同比增长 | decimal(20,4) | 是 |  |  |
| 26 | OPER_L_QOQ | 经营性流动负债环比增长 | decimal(20,4) | 是 |  |  |
| 27 | OPER_LR_YOYD | 经营性流动负债率同比差值 | decimal(20,4) | 是 |  |  |
