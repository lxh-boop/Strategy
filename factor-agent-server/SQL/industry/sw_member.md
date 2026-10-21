# sw_member（申万行业成分）字段描述

> 来源：Tushare Pro 接口 index_member_all（参数 is_new=Y/N 两批合并）实测下载（2026-10-17，2026-10-20 重新下载），字段描述按接口实际返回列整理，非通联字典原文。
> 表级说明见 [tables.md](tables.md)；数据文件 [sw_member_current.csv](sw_member_current.csv)（is_new=Y）+ [sw_member_historical.csv](sw_member_historical.csv)（is_new=N），导入 DuckDB 时合并为一张表。

**表描述**：个股申万行业归属的全量进出记录：在册 5918 行（is_new=Y，out_date 为空）+ 已调出 2006 行（is_new=N，out_date 非空）；一、二、三级行业编码与名称齐全。时点归属（PIT）查询：某日在册 = in_date ≤ 该日 ≤ out_date（out_date 为空视为仍在册）。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | l1_code | 一级行业指数代码 | varchar(12) | 否 | 如 801120.SI | 注1 |
| 2 | l1_name | 一级行业名称 | varchar(40) | 否 | 如 食品饮料 |  |
| 3 | l2_code | 二级行业指数代码 | varchar(12) | 否 |  |  |
| 4 | l2_name | 二级行业名称 | varchar(40) | 否 |  |  |
| 5 | l3_code | 三级行业指数代码 | varchar(12) | 否 |  |  |
| 6 | l3_name | 三级行业名称 | varchar(40) | 否 |  |  |
| 7 | ts_code | 股票代码 | varchar(12) | 否 | 带交易所后缀，如 600519.SH | 注2 |
| 8 | name | 股票简称 | varchar(20) | 否 |  |  |
| 9 | in_date | 纳入日期 | varchar(8) | 否 | yyyyymmdd |  |
| 10 | out_date | 调出日期 | varchar(8) | 是 | 空 = 当前在册；非空即已调出 |  |
| 11 | is_new | 是否在册 | char(1) | 否 | Y 在册 / N 已调出 |  |

## 备注说明

- 注1：与分类表（sw_classify）的 index_code 同口径，可反查层级与父级。
- 注2：后缀 .SH 上交所 / .SZ 深交所 / .BJ 北交所。行业筛选引擎按本表做时点归属解析（PIT），期内调出行业的股票在下次调仓自然剔除。
