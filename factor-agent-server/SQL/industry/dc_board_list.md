# dc_board_list（东财板块清单）字段描述

> 来源：由 dc_board_index 按板块代码去重派生（2026-10-17），非通联字典原文。
> 表级说明见 [tables.md](tables.md)；数据文件 [dc_board_list.csv](dc_board_list.csv)。

**表描述**：东方财富板块的静态清单，共 1046 个板块，用于板块代码与名称、类型的对照。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ts_code | 板块代码 | varchar(12) | 否 | 如 BK1757.DC |  |
| 2 | name | 板块名称 | varchar(40) | 否 |  |  |
| 3 | idx_type | 板块类型 | varchar(10) | 否 | 如 概念板块、行业板块 |  |
| 4 | first_seen_trade_date | 首见交易日期 | varchar(8) | 否 | 该板块在下载快照中出现的最早交易日 |  |

## 备注说明

- 本表为派生数据，重新下载 dc_board_index 后需同步再生。
