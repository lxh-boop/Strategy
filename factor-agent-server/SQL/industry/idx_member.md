# idx_member（指数成分月度快照）字段描述

> 来源：Tushare Pro 接口 index_weight（按年分段拉取 2005 至今，按 index_code+trade_date 去重），字段描述按接口实际返回列整理，非通联字典原文。
> 表级说明见 [tables.md](tables.md)；数据文件 [idx_member.csv](idx_member.csv)。

**表描述**：宽基指数成分的月度快照序列：每个指数每月月末一条成分名单（trade_date = 快照日）。时点归属（PIT）查询：取 trade_date ≤ 决策日 的最近一个快照的成分名单——期内指数调样在下次调仓自然跟随，与申万成分表（sw_member 进出记录模型）语义等价、存储形态不同。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | index_code | 指数代码 | varchar(12) | 否 | 如 000300.SH | 注1 |
| 2 | con_code | 成分股代码 | varchar(12) | 否 | 带交易所后缀，如 600519.SH | 注2 |
| 3 | trade_date | 快照日 | varchar(8) | 否 | 该月月末交易日，yyyyymmdd | 注3 |
| 4 | weight | 权重 | decimal | 是 | 收盘市值权重 %，池筛选不消费此列 |  |

## 备注说明

- 注1：池筛选引擎按本表做指数成分的时点归属解析；默认下载 000300.SH（沪深300）/ 000905.SH（中证500）/ 000016.SH（上证50），可用环境变量 POOL_INDEX_CODES 扩展。
- 注2：后缀 .SH 上交所 / .SZ 深交所；导入后经引擎统一映射为 .XSHG/.XSHE 口径。
- 注3：快照模型不依赖 in_date/out_date（index_weight 的进出日期存在大量缺失）；某日在册 = 该日之前最近一次快照中在列。
