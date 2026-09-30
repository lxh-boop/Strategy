# mkt_idxd（指数日行情）因子字段描述

> 来源：通联离线数据字典 V1.6《通联股票数据库 V1.6》1.0_指数行情 / 1.0_日周月季年行情，字段描述均为字典原文。
> 表级说明见 [tables.md](tables.md)。

**表描述**：获取指数的日度收盘信息，包含昨收价、开盘价、最高价、最低价、收盘价、成交量、成交金额等字段。沪深重要指数的更新时间为15:30，其他指数因发布机构不同会陆续更新。成交量单位：股票指数??股，基金指数??份，债券指数??万元。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 信息编码 | bigint | 否 |  |  |
| 2 | INDEX_ID | 证券内部ID | bigint | 否 |  | 注1 |
| 3 | TICKER_SYMBOL | 交易代码 | varchar(30) | 是 |  | 注2 |
| 4 | EXCHANGE_CD | 交易市场代码 | char(4) | 是 |  |  |
| 5 | TRADE_DATE | 交易日期 | date | 否 |  |  |
| 6 | PRE_CLOSE_INDEX | 昨收盘价 | decimal(11,5) | 是 | 前一个交易日收盘点位 |  |
| 7 | OPEN_INDEX | 开盘价 | decimal(11,5) | 是 | 指数开盘点位 |  |
| 8 | HIGHEST_INDEX | 最高价 | decimal(11,5) | 是 | 指数最高点位 |  |
| 9 | LOWEST_INDEX | 最低价 | decimal(11,5) | 是 | 指数最低点位 |  |
| 10 | CLOSE_INDEX | 收盘价 | decimal(11,5) | 是 | 指数收盘点位 |  |
| 11 | TURNOVER_VALUE | 成交金额 | decimal | 是 | 指数成分成交金额汇总,针对南华单品种指数,该字段为持仓量 |  |
| 12 | TURNOVER_VOL | 成交量 | decimal(19,2) | 是 | 指数成分成交量汇总 |  |
| 13 | CHG | 涨跌 | decimal(19,5) | 是 | 收盘价-昨收盘价 |  |
| 14 | CHG_PCT | 涨跌幅 | decimal | 是 | 收盘价/昨收盘价-1 |  |
| 15 | UPDATE_TIME | 更新时间 | datetime | 是 |  |  |

## 备注说明

- [1]证券内部ID(INDEX_ID)可与证券主表(md_security)的证券内部ID(SECURITY_ID)字段关联。
- [2]交易代码(TICKER_SYMBOL)可与证券主表(md_security)的交易代码(TICKER_SYMBOL)字段关联。
