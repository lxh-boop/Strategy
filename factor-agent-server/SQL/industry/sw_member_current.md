# sw_member_current（申万行业成分·在册）字段描述

> 来源：Tushare Pro 接口 index_member_all（参数 is_new=Y）实测下载（2026-10-17），字段描述按接口实际返回列整理，非通联字典原文。
> 表级说明见 [tables.md](tables.md)；数据文件 [sw_member_current.csv](sw_member_current.csv)。

**表描述**：当前在册的个股申万行业归属，共 5918 行；一、二、三级行业编码与名称齐全，in_date 为纳入日期，out_date 为空。

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
| 10 | out_date | 调出日期 | varchar(8) | 是 | 本表恒为空 |  |
| 11 | is_new | 是否在册 | char(1) | 否 | 本表恒为 Y |  |

## 备注说明

- 注1：与分类表（sw2021_classify）的 index_code 同口径，可反查层级与父级。
- 注2：后缀 .SH 上交所 / .SZ 深交所 / .BJ 北交所。已调出的历史归属见 [sw_member_historical.md](sw_member_historical.md)。
