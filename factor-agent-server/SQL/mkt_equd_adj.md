# mkt_equd_adj（股票前复权日行情）因子字段描述

> 来源：通联离线数据字典 V1.6《通联股票数据库 V1.6》1.0_股票行情 / 2.0_复权行情，字段描述均为字典原文。
> 表级说明见 [tables.md](tables.md)。

**表描述**：获取沪深京股票前复权收盘日行情，包含前复权调整后的昨收价、开盘价、最高价、最低价、收盘价等。于除权除息日对历史行情的调整，更新时间为9:00前。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 信息编码 | bigint | 否 |  |  |
| 2 | SECURITY_ID | 证券内部ID | bigint | 否 |  | 注1 |
| 3 | TICKER_SYMBOL | 交易代码 | varchar(20) | 否 |  |  |
| 4 | EXCHANGE_CD | 交易市场代码 | char(4) | 是 |  |  |
| 5 | TRADE_DATE | 交易日期 | date | 否 |  |  |
| 6 | PRE_CLOSE_PRICE | 昨收盘 | decimal(9,3) | 是 | 交易所给出的复权前收价 |  |
| 7 | ACT_PRE_CLOSE_PRICE | 实际昨收盘 | decimal(9,3) | 是 | 非复权实际前一个交易日的收盘价 |  |
| 8 | OPEN_PRICE | 今开盘 | decimal(9,3) | 是 | 当日开盘价格 |  |
| 9 | HIGHEST_PRICE | 最高价 | decimal(9,3) | 是 | 当日最高价格 |  |
| 10 | LOWEST_PRICE | 最低价 | decimal(9,3) | 是 | 当日最低价格 |  |
| 11 | CLOSE_PRICE | 今收盘 | decimal(9,3) | 是 | 当日收盘价格 |  |
| 12 | PRE_CLOSE_PRICE_1 | 昨收盘(前复权) | decimal(9,3) | 是 | 复权昨收盘(累次复权的结果) |  |
| 13 | OPEN_PRICE_1 | 今开盘(前复权) | decimal(9,3) | 是 | 当日开盘价格(累次复权的结果) |  |
| 14 | HIGHEST_PRICE_1 | 最高价(前复权) | decimal(9,3) | 是 | 当日最高价格(累次复权的结果) |  |
| 15 | LOWEST_PRICE_1 | 最低价(前复权) | decimal(9,3) | 是 | 当日最低价格(累次复权的结果) |  |
| 16 | CLOSE_PRICE_1 | 今收盘(前复权) | decimal(9,3) | 是 | 当日收盘价格(累次复权的结果) |  |
| 17 | TURNOVER_VOL | 成交量(前复权) | bigint | 是 | 当日成交量(累次复权的结果) |  |
| 18 | ADJ_FACTOR_1 | 复权因子(前复权) | float | 是 | 一次除权除息后的价格和除权除息之前的价格比值 |  |
| 19 | ACCUM_ADJ_FACTOR | 累积复权因子 | float | 是 | 多次除权除息后的价格和除权除息之前的价格比值 |  |
| 20 | UPDATE_TIME | 更新时间 | datetime | 是 |  |  |

## 备注说明

- [1]证券内部ID(SECURITY_ID)可与证券主表(md_security)的证券内部ID(SECURITY_ID)字段关联。
