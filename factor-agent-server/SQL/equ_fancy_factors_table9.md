# equ_fancy_factors_table9（精品因子库数据表9）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》1.0_股票 / 2.0_A股精品因子库，字段信息照录字典原文。
> 表级说明见 [tables.md](tables.md)。
> 注：字典未提供本表字段的「字段描述」文字，该列照字典留空，因子含义见「中文名称」列。

**表描述**：记录了精品因子库的22个因子的每日数据。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TICKER_SYMBOL | 股票代码 | varchar(20) | 否 |  |  |
| 3 | TRADE_DATE | 日期 | date | 否 |  |  |
| 4 | NEWS_NUM_30 | 月度热度 | decimal(20,4) | 是 |  |  |
| 5 | NEWS_NUM_NEG_30 | 负面月度热度 | decimal(20,4) | 是 |  |  |
| 6 | NEWS_NUM_VOL_30 | 月度热度波动 | decimal(20,4) | 是 |  |  |
| 7 | NEWS_NUM_POS_VOL_30 | 正面月度热度波动 | decimal(20,4) | 是 |  |  |
| 8 | NEWS_NUM_VOL_LT | 年度热度波动 | decimal(20,4) | 是 |  |  |
| 9 | GTRA_BUY_HOT | G买入交易热度 | decimal(20,4) | 是 |  |  |
| 10 | GTRA_BUY_HOT_CHG | G买入热度变化 | decimal(20,4) | 是 |  |  |
| 11 | GTRA_SELL_HOT_CHG | G卖出热度变化 | decimal(20,4) | 是 |  |  |
| 12 | GTRA_BUY_PCT | G买入占比 | decimal(20,4) | 是 |  |  |
| 13 | GTRA_SELL_PCT | G卖出占比 | decimal(20,4) | 是 |  |  |
| 14 | GTRA_BUY_PCT_VOL | G买入占比波动 | decimal(20,4) | 是 |  |  |
| 15 | GTRA_SELL_PCT_VOL | G卖出占比波动 | decimal(20,4) | 是 |  |  |
| 16 | XTRA_BUY_HOT | X买入交易热度 | decimal(20,4) | 是 |  |  |
| 17 | XTRA_BUY_HOT_CHG | X买入热度变化 | decimal(20,4) | 是 |  |  |
| 18 | XTRA_SELL_HOT_CHG | X卖出热度变化 | decimal(20,4) | 是 |  |  |
| 19 | XTRA_BUY_PCT | X买入占比 | decimal(20,4) | 是 |  |  |
| 20 | XTRA_SELL_PCT | X卖出占比 | decimal(20,4) | 是 |  |  |
| 21 | XTRA_BUY_PCT_VOL | X买入占比波动 | decimal(20,4) | 是 |  |  |
| 22 | XTRA_SELL_PCT_VOL | X卖出占比波动 | decimal(20,4) | 是 |  |  |
| 23 | GPOST_HOT | G帖子热度波动 | decimal(20,4) | 是 |  |  |
| 24 | GPOST_POS_PCT_VOL | G正面帖子占比波动 | decimal(20,4) | 是 |  |  |
| 25 | GPOST_NEG_PCT_VOL | G负面帖子占比波动 | decimal(20,4) | 是 |  |  |
