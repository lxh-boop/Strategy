# dc_board_index（东财板块日行情）字段描述

> 来源：Tushare Pro 接口 dc_index 实测下载（2026-10-17），字段描述按接口实际返回列整理，非通联字典原文。
> 表级说明见 [tables.md](tables.md)；数据文件 [dc_board_index.csv](dc_board_index.csv)。

**表描述**：东方财富板块（行业板块、概念板块等）的日行情快照，含领涨股、涨跌幅、总市值与涨跌家数。接口单页上限 5000 行，当前文件覆盖最近 5 个交易日。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ts_code | 板块代码 | varchar(12) | 否 | 如 BK1757.DC | 注1 |
| 2 | trade_date | 交易日期 | varchar(8) | 否 | yyyyymmdd |  |
| 3 | name | 板块名称 | varchar(40) | 否 | 如 2026三季报扭亏 |  |
| 4 | leading | 领涨股简称 | varchar(20) | 否 |  |  |
| 5 | leading_code | 领涨股代码 | varchar(12) | 否 |  |  |
| 6 | pct_change | 板块涨跌幅 | decimal | 否 | 单位 % |  |
| 7 | leading_pct | 领涨股涨幅 | decimal | 否 | 单位 % |  |
| 8 | total_mv | 板块总市值 | decimal | 否 |  | 注2 |
| 9 | turnover_rate | 换手率 | decimal | 否 | 单位 % |  |
| 10 | up_num | 上涨家数 | int | 否 |  |  |
| 11 | down_num | 下跌家数 | int | 否 |  |  |
| 12 | idx_type | 板块类型 | varchar(10) | 否 | 如 概念板块、行业板块 |  |
| 13 | level | 板块层级 | varchar(4) | 是 | 接口返回为空 |  |

## 备注说明

- 注1：板块代码与清单表（dc_board_list）同口径。
- 注2：单位以 Tushare 文档为准（下载时未做换算）。
