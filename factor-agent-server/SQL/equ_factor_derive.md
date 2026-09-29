# equ_factor_derive（股票因子_衍生数据）因子字段描述

> 来源：通联离线数据字典 V1.6《通联量化因子库 V1.6》1.0_股票 / 1.0_424因子库，字段描述均为字典原文。
> 表级说明见 [tables.md](tables.md)。

**表描述**：这类因子是财报数据的衍生，如净利润的TTM数值、息税前净利润（EBIT）等。

## 字段信息

| 序号 | 字段名 | 中文名称 | 数据类型 | 可空 | 字段描述 | 备注 |
|---|---|---|---|---|---|---|
| 1 | ID | 自增ID | bigint | 否 |  |  |
| 2 | SECURITY_ID_INT | 证券ID(整型) | bigint | 否 |  | 注1 |
| 3 | SECURITY_ID | 证券ID(字符串) | varchar(50) | 否 |  | 注2 |
| 4 | TRADE_DATE | 交易日期 | bigint | 否 |  |  |
| 5 | TICKER_SYMBOL | 股票交易代码 | varchar(6) | 否 |  | 注3 |
| 6 | TotalFixedAssets | 固定资产合计 | decimal(20,4) | 是 | 固定资产合计。属于基础科目与衍生类因子。 |  |
| 7 | IntFreeCL | 无息流动负债 | decimal(20,4) | 是 | 无息流动负债。属于基础科目与衍生类因子。 |  |
| 8 | IntFreeNCL | 无息非流动负债 | decimal(20,4) | 是 | 无息非流动负债。属于基础科目与衍生类因子。 |  |
| 9 | IntCL | 带息流动负债 | decimal(20,4) | 是 | 带息流动负债。属于基础科目与衍生类因子。 |  |
| 10 | IntDebt | 带息债务 | decimal(20,4) | 是 | 带息债务。属于基础科目与衍生类因子。 |  |
| 11 | NetDebt | 净债务 | decimal(20,4) | 是 | 净债务。属于基础科目与衍生类因子。 |  |
| 12 | NetTangibleAssets | 有形净资产/有形资产净值 | decimal(20,4) | 是 | 有形净资产/有形资产净值。属于基础科目与衍生类因子。 |  |
| 13 | WorkingCapital | 运营资本 | decimal(20,4) | 是 | 运营资本。属于基础科目与衍生类因子。 |  |
| 14 | NetWorkingCapital | 净运营资本 | decimal(20,4) | 是 | 净运营资本。属于基础科目与衍生类因子。 |  |
| 15 | TotalPaidinCapital | 全部投入资本 | decimal(20,4) | 是 | 全部投入资本。属于基础科目与衍生类因子。 |  |
| 16 | RetainedEarnings | 留存收益 | decimal(20,4) | 是 | 留存收益。属于基础科目与衍生类因子。 |  |
| 17 | OperateNetIncome | 经营活动净收益 | decimal(20,4) | 是 | 经营活动净收益。属于基础科目与衍生类因子。 |  |
| 18 | ValueChgProfit | 价值变动净收益 | decimal(20,4) | 是 | 价值变动净收益。属于基础科目与衍生类因子。 |  |
| 19 | NetIntExpense | 净利息费用 | decimal(20,4) | 是 | 净利息费用。属于基础科目与衍生类因子。 |  |
| 20 | EBIT | 息税前利润 | decimal(20,4) | 是 | 息税前利润。属于基础科目与衍生类因子。 |  |
| 21 | EBITDA | 息税折旧摊销前利润 | decimal(20,4) | 是 | 息税折旧摊销前利润。属于基础科目与衍生类因子。 |  |
| 22 | EBIAT | 息前税后利润 | decimal(20,4) | 是 | 息前税后利润。属于基础科目与衍生类因子。 |  |
| 23 | NRProfitLoss | 非经常性损益 | decimal(20,4) | 是 | 非经常性损益。属于基础科目与衍生类因子。 |  |
| 24 | NIAPCut | 扣除非经常性损益后的归属于母公司所有者权益净利润 | decimal(20,4) | 是 | 扣除非经常性损益后的归属于母公司所有者权益净利润。属于基础科目与衍生类因子。 |  |
| 25 | FCFF | 企业自由现金流量 | decimal(20,4) | 是 | 企业自由现金流量TTM。属于基础科目与衍生类因子。 |  |
| 26 | FCFE | 股权自由现金流量 | decimal(20,4) | 是 | 股权自由现金流量。属于基础科目与衍生类因子。 |  |
| 27 | DA | 折旧和摊销 | decimal(20,4) | 是 | 折旧和摊销。属于基础科目与衍生类因子。 |  |
| 28 | TRevenueTTM | 营业总收入，TTM值 | decimal(20,4) | 是 | 营业总收入，TTM值。属于基础科目与衍生类因子。 |  |
| 29 | TCostTTM | 营业总成本，TTM值 | decimal(20,4) | 是 | 营业总成本，TTM值。属于基础科目与衍生类因子。 |  |
| 30 | RevenueTTM | 营业收入，TTM值 | decimal(20,4) | 是 | 营业收入，TTM值。属于基础科目与衍生类因子。 |  |
| 31 | CostTTM | 营业成本，TTM值 | decimal(20,4) | 是 | 营业成本，TTM值。属于基础科目与衍生类因子。 |  |
| 32 | GrossProfitTTM | 毛利，TTM值 | decimal(20,4) | 是 | 毛利，TTM值。属于基础科目与衍生类因子。 |  |
| 33 | SalesExpenseTTM | 销售费用，TTM值 | decimal(20,4) | 是 | 销售费用，TTM值。属于基础科目与衍生类因子。 |  |
| 34 | AdminExpenseTTM | 管理费用，TTM值 | decimal(20,4) | 是 | 管理费用，TTM值。属于基础科目与衍生类因子。 |  |
| 35 | FinanExpenseTTM | 财务费用，TTM值 | decimal(20,4) | 是 | 财务费用，TTM值。属于基础科目与衍生类因子。 |  |
| 36 | AssetImpairLossTTM | 资产减值损失，TTM值 | decimal(20,4) | 是 | 资产减值损失，TTM值。属于基础科目与衍生类因子。(因为财务准则变更，该字段废弃) |  |
| 37 | NPFromOperatingTTM | 经营活动净收益，TTM值 | decimal(20,4) | 是 | 经营活动净收益，TTM值。属于基础科目与衍生类因子。 |  |
| 38 | NPFromValueChgTTM | 价值变动净收益，TTM值 | decimal(20,4) | 是 | 价值变动净收益，TTM值。属于基础科目与衍生类因子。 |  |
| 39 | OperateProfitTTM | 营业利润，TTM值 | decimal(20,4) | 是 | 营业利润，TTM值。属于基础科目与衍生类因子。 |  |
| 40 | NonOperatingNPTTM | 营业外收支净额，TTM值 | decimal(20,4) | 是 | 营业外收支净额，等于营业外收入减营业外支出（均取TTM值）。属于基础科目与衍生类因子。 |  |
| 41 | TProfitTTM | 利润总额，TTM值 | decimal(20,4) | 是 | 利润总额，TTM值。属于基础科目与衍生类因子。 |  |
| 42 | NetProfitTTM | 净利润，TTM值 | decimal(20,4) | 是 | 净利润，TTM值。属于基础科目与衍生类因子。 |  |
| 43 | NetProfitAPTTM | 归属于母公司股东的净利润，TTM值 | decimal(20,4) | 是 | 归属于母公司股东的净利润，TTM值。属于基础科目与衍生类因子。 |  |
| 44 | SaleServiceRenderCashTTM | 销售商品提供劳务收到的现金，TTM值 | decimal(20,4) | 是 | 销售商品提供劳务收到的现金，TTM值。属于基础科目与衍生类因子。 |  |
| 45 | NetOperateCFTTM | 经营活动现金流量净额，TTM值 | decimal(20,4) | 是 | 经营活动现金流量净额，TTM值。属于基础科目与衍生类因子。 |  |
| 46 | NetInvestCFTTM | 投资活动现金流量净额，TTM值 | decimal(20,4) | 是 | 投资活动现金流量净额，TTM值。属于基础科目与衍生类因子。 |  |
| 47 | NetFinanceCFTTM | 筹资活动现金流量净额，TTM值 | decimal(20,4) | 是 | 筹资活动现金流量净额，TTM值。属于基础科目与衍生类因子。 |  |
| 48 | GrossProfit | 毛利润 | decimal(20,4) | 是 | 毛利。属于基础科目与衍生类因子。 |  |
| 49 | UPDATE_TIME | 更新时间 | datetime | 否 |  |  |

## 备注说明

- [1]证券ID(整型)(SECURITY_ID_INT)可与证券主表(md_security)的证券内部ID(SECURITY_ID)字段关联。
- [2]证券ID(字符串)(SECURITY_ID)可与证券主表(md_security)的证券展示代码(DYID)字段关联。
- [3]股票交易代码(TICKER_SYMBOL)可与证券主表(md_security)的交易代码(TICKER_SYMBOL)字段关联。
