# equ_fancy_factors_table5（精品因子库数据表5）因子字段描述

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
| 4 | AI_DA_PE_60 | AI市盈率60日变化 | decimal(20,4) | 是 |  |  |
| 5 | AI_DA_PE_90 | AI市盈率90日变化 | decimal(20,4) | 是 |  |  |
| 6 | AI_DA_PS_30 | AI市销率30日变化 | decimal(20,4) | 是 |  |  |
| 7 | AI_DA_PS_60 | AI市销率60日变化 | decimal(20,4) | 是 |  |  |
| 8 | AI_DA_PS_90 | AI市销率90日变化 | decimal(20,4) | 是 |  |  |
| 9 | AST_RPT_SENTIMENT_W | 研报情感得分加权求和 | decimal(20,4) | 是 |  |  |
| 10 | AST_RPT_SENTIMENT_Z180 | 研报情感180日标准化 | decimal(20,4) | 是 |  |  |
| 11 | AST_RPT_SENTIMENT_Z365 | 研报情感365日标准化 | decimal(20,4) | 是 |  |  |
| 12 | AST_RPT_SENTIMENT_Z730 | 研报情感730日标准化 | decimal(20,4) | 是 |  |  |
| 13 | FMZL_1Y_IPCNUM_SUM | 过去1年发明专利IPC总数 | decimal(20,4) | 是 |  |  |
| 14 | FMZL_1Y_RELATEDNUM_SUM | 过去1年发明专利关联公司总数 | decimal(20,4) | 是 |  |  |
| 15 | FMZL_1Y_OWNPARENT_SUM | 过去1年发明专利独权专利总数 | decimal(20,4) | 是 |  |  |
| 16 | FMZL_1Y_REVIEWDAY_SUM | 过去1年发明专利审核总时间 | decimal(20,4) | 是 |  |  |
| 17 | FMZL_1Y_RELATEDNUM_MAX | 过去1年发明专利关联公司最大值 | decimal(20,4) | 是 |  |  |
| 18 | BCVP_05M_20D | 收盘成交量占比 | decimal(20,4) | 是 |  |  |
| 19 | OCVP_05M_20D | 集合竞价成交量占比 | decimal(20,4) | 是 |  |  |
| 20 | CORR_VPL_05M_20D | 大成交量下量价相关性 | decimal(20,4) | 是 |  |  |
| 21 | UPP_01M_20D | 高频上行波动率 | decimal(20,4) | 是 |  |  |
| 22 | DDP_01M_20D | 高频上行波动占比 | decimal(20,4) | 是 |  |  |
| 23 | VOLL_01M_20D | 大成交量下波动率 | decimal(20,4) | 是 |  |  |
