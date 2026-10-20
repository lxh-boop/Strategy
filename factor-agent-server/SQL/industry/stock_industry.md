# stock_industry（个股基础信息）字段描述

> 来源：Tushare Pro 接口 stock_basic（参数 list_status=L）实测下载（2026-10-17），字段描述按接口实际返回列整理，非通联字典原文。
> 表级说明见 [tables.md](tables.md)；数据文件 [stock_industry.csv](stock_industry.csv)。

**表描述**：全部上市个股基础信息共 5577 行，含 Tushare 口径的行业字段，可作为最简明的个股所属行业对照。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ts_code | 股票代码 | varchar(12) | 否 | 带交易所后缀 |  |
| 2 | symbol | 交易代码 | varchar(10) | 否 | 六位数字代码 |  |
| 3 | name | 股票简称 | varchar(20) | 否 |  |  |
| 4 | area | 地域 | varchar(20) | 是 | 注册地省份或城市 |  |
| 5 | industry | 行业 | varchar(20) | 否 | Tushare 口径行业名称，如 乳制品、汽车配件 | 注1 |
| 6 | cnspell | 简称拼音 | varchar(20) | 是 |  |  |
| 7 | market | 市场 | varchar(10) | 否 | 主板 / 创业板 / 科创板 / 北交所 |  |
| 8 | list_date | 上市日期 | varchar(8) | 否 | yyyyymmdd |  |
| 9 | act_name | 实际控制人 | varchar(100) | 是 |  |  |
| 10 | act_ent_type | 实际控制人企业类型 | varchar(30) | 是 | 如 地方国企、民营 |  |

## 备注说明

- 注1：industry 为 Tushare 自有口径，与申万分类名不完全一致（数量更多、粒度更细），仅作简明对照，严谨的行业归属以申万成分表为准。
