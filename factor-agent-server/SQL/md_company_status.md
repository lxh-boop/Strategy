# md_company_status（上市公司特殊状态）字段描述

> 来源：通联离线数据字典 V1.6 《通联股票数据库 V1.6》2.0_公司行为 / 1.0_基本信息 / 5.0_上市公司特殊状态，字段描述均为字典原文。
> 表级说明见 [tables.md](tables.md)。

**表描述**：记录上市公司发生特殊状态处理的信息，包含交易代码、变更后证券简称、公司状态等信息。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | PARTY_ID | 机构内部ID | bigint | 是 | 注1 |  |
| 3 | SECURITY_ID | 证券内部ID | bigint | 是 |  |  |
| 4 | TICKER_SYMBOL | 交易代码 | varchar(20) | 否 | 注2 |  |
| 5 | SEC_SHORT_NAME | 变更后证券简称 | varchar(100) | 是 |  |  |
| 6 | PARTY_STATE | 公司状态 | int | 否 | CODE_TYPE_ID = 90030 |  |
| 7 | PUBLISH_DATE | 公告日期 | date | 是 |  |  |
| 8 | EFF_DATE | 生效日期 | date | 否 |  |  |
| 9 | REASON | 原因 | int | 是 | CODE_TYPE_ID = 90031 |  |
| 10 | UPDATE_TIME | 更新时间 | datetime | 否 |  |  |

## 备注说明

- [1]机构内部ID(PARTY_ID)可与机构主表(md_institution)的机构内部ID(PARTY_ID)字段关联。
- [2]交易代码(TICKER_SYMBOL)可与证券主表(md_security)的交易代码(TICKER_SYMBOL)字段关联。
- [3]公司状态枚举（CODE_TYPE_ID = 90030）：7 PUBLISH_DATE 公告日期 date 是 8 EFF_DATE 生效日期 date 否 9 REASON 原因 int 是
- [4]原因枚举（CODE_TYPE_ID = 90031）：CODE_TYPE_ID = 90031 10 UPDATE_TIME 更新时间 datetime 否
- [5]表名按文档标题拟名，以库内实际表名为准。
