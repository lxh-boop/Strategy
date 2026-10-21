# sw_classify（申万行业分类）字段描述

> 来源：Tushare Pro 接口 index_classify（参数 src=SW2021）实测下载（2026-10-17），字段描述按接口实际返回列整理，非通联字典原文。
> 表级说明见 [tables.md](tables.md)；数据文件 [sw2021_classify.csv](sw2021_classify.csv)（表名 = DuckDB 库表名）。

**表描述**：申万 2021 行业分类标准全层级目录，覆盖一级、二级、三级共 511 个行业节点，经 parent_code 逐级挂接。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | index_code | 行业指数代码 | varchar(12) | 否 | 申万行业指数代码，如 801010.SI | 注1 |
| 2 | industry_name | 行业名称 | varchar(40) | 否 | 如 农林牧渔、基础化工 |  |
| 3 | level | 行业层级 | varchar(4) | 否 | L1 一级 / L2 二级 / L3 三级 |  |
| 4 | industry_code | 行业代码 | varchar(12) | 否 | 数字行业编码，如 110000 |  |
| 5 | is_pub | 是否发布 | tinyint | 否 | 1 = 已发布 |  |
| 6 | parent_code | 父级行业代码 | varchar(12) | 否 | 上级行业的 industry_code，一级为 0 | 注2 |
| 7 | src | 分类源 | varchar(10) | 否 | 固定 SW2021 |  |

## 备注说明

- 注1：index_code 与成分表（sw_member）的 l1_code / l2_code / l3_code 同口径。
- 注2：L1 共 31 个，自顶向下展开 L2、L3。
