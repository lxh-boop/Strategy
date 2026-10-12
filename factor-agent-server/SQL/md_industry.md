# md_industry（行业成分）字段描述

> 来源：通联离线数据字典 V1.6 《通联主表数据库 V1.6》1.0_机构相关表 / 4.0_行业成分，字段描述均为字典原文。
> 表级说明见 [tables.md](tables.md)。

**表描述**：记录上市公司所属行业的进出记录，包含公司代码、行业编码、纳入日期、剔除日期，是否最新等。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | TYPE_ID | 行业ID | varchar(20) | 否 | 注1 |  |
| 3 | PARTY_ID | 机构内部ID | bigint | 否 | 注2 |  |
| 4 | INTO_DATE | 纳入日期 | date | 否 |  |  |
| 5 | OUT_DATE | 剔除日期 | date | 是 |  |  |
| 6 | IS_NEW | 是否最新 | smallint | 否 | CODE_TYPE_ID = 10007 |  |
| 7 | UPDATE_TIME | 更新时间 | datetime | 是 |  |  |

## 备注说明

- [1]行业ID(TYPE_ID)可与行业分类标准(md_type)的分类ID(TYPE_ID)字段关联。
- [2]机构内部ID(PARTY_ID)可与机构主表(md_institution)的机构内部ID(PARTY_ID)字段关联。
- [3]IS_NEW=1 为当前生效成分；OUT_DATE 非空即已剔除。表名按文档标题拟名，以库内实际表名为准。
