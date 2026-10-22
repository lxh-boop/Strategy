# 通联数据字典 —— 表描述

> 来源：通联离线数据字典 V1.6，以下文字均照录字典原文（仅 equ_factor_obos 条目的描述为按库表元数据自拟）。
> 字段级说明见 [equ_factor_cf.md](equ_factor_cf.md)、[equ_factor_derive.md](equ_factor_derive.md)、[equ_factor_obos.md](equ_factor_obos.md) 与 [mkt_adjf.md](mkt_adjf.md)。可转债因子库 cb_factors_table1~6 与 A股精品因子库 equ_fancy_factors_table1~10 的字段级说明见同名 <表名>.md。

## equ_factor_cf（股票因子_现金流指标）

- 描述 : 该类别体现了公司的现金流信息，如经营活动产生的现金流量净额增长率，反映了公司的现金流增长是否健康。
- 唯一键 : SECURITY_ID_INT,TRADE_DATE

## equ_factor_derive（股票因子_衍生数据）

- 描述 : 这类因子是财报数据的衍生，如净利润的TTM数值、息税前净利润（EBIT）等。
- 唯一键 : SECURITY_ID_INT,TRADE_DATE

## equ_factor_obos（股票因子_超买超卖型）

- 描述 : 这类因子由日K线价格序列运算得到，刻画股价的超买超卖与摆动状态，如乖离率、随机指标、相对强弱指标、价格动量与波动率等，反映短期价格偏离与反转特征，不依赖财报数据。
- 唯一键 : SECURITY_ID_INT,TRADE_DATE

## cb_factors_table1（可转债因子库数据表1）

- 描述 : 记录了可转债因子库的30个可转债估值因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## cb_factors_table2（可转债因子库数据表2）

- 描述 : 记录了可转债因子库的22个可转债日线量价因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## cb_factors_table3（可转债因子库数据表3）

- 描述 : 记录了可转债因子库的30个正股转债结合日线量价因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## cb_factors_table4（可转债因子库数据表4）

- 描述 : 记录了可转债因子库的20个可转债分钟线量价因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## cb_factors_table5（可转债因子库数据表5）

- 描述 : 记录了可转债因子库的30个可转债分钟线量价因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## cb_factors_table6（可转债因子库数据表6）

- 描述 : 记录了可转债因子库的32个可转债估值因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table1（精品因子库数据表1）

- 描述 : 记录了精品因子库的20个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table2（精品因子库数据表2）

- 描述 : 记录了精品因子库的20个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table3（精品因子库数据表3）

- 描述 : 记录了精品因子库的20个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table4（精品因子库数据表4）

- 描述 : 记录了精品因子库的20个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table5（精品因子库数据表5）

- 描述 : 记录了精品因子库的20个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table6（精品因子库数据表6）

- 描述 : 记录了精品因子库的20个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table7（精品因子库数据表7）

- 描述 : 记录了精品因子库的21个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table8（精品因子库数据表8）

- 描述 : 记录了精品因子库的21个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table9（精品因子库数据表9）

- 描述 : 记录了精品因子库的22个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE

## equ_fancy_factors_table10（精品因子库数据表10）

- 描述 : 记录了精品因子库的24个因子的每日数据。
- 唯一键 : TICKER_SYMBOL,TRADE_DATE
## mkt_adjf（股票前复权因子）

- 描述 : 获取沪深京股票用来调整历史行情的前复权因子数据，包含除权除息日、除权除息事项具体数据、本次复权因子、累积复权因子以及对应的生效日期区间。该因子用来调整历史行情，不作为预测使用，于除权除息日进行计算调整。只在发生分红、配股、股改事件的除权除息日才有复权因子记录。
- 唯一键 : EX_DIV_DATE,SECURITY_ID

## mkt_equd_adj（股票前复权日行情）

- 描述 : 获取沪深京股票前复权收盘日行情，包含前复权调整后的昨收价、开盘价、最高价、最低价、收盘价等。于除权除息日对历史行情的调整，更新时间为9:00前。
- 唯一键 : SECURITY_ID,TRADE_DATE

## mkt_idxd（指数日行情）

- 描述 : 获取指数的日度收盘信息，包含昨收价、开盘价、最高价、最低价、收盘价、成交量、成交金额等字段。沪深重要指数的更新时间为15:30，其他指数因发布机构不同会陆续更新。成交量单位：股票指数??股，基金指数??份，债券指数??万元。
- 唯一键 : INDEX_ID,TRADE_DATE

## md_security（证券主表）

- 描述 : 记录证券编码及上市基本信息，如交易代码、交易市场、证券简称、上市日期、状态等。
- 唯一键 : SECURITY_ID

## md_industry（行业成分）

- 描述 : 记录上市公司所属行业的进出记录，包含公司代码、行业编码、纳入日期、剔除日期，是否最新等。
- 唯一键 : ID

## md_type（行业分类标准）

- 描述 : 记录机构、证券与批文的多种分类目录汇总表，主要包括行业分类、证券类型分类、地域分类明细等。
- 唯一键 : ID

## md_type_description（行业简介）

- 描述 : 行业分类目录的名称与简介说明表。
- 唯一键 : ID

## md_company_status（上市公司特殊状态）

- 描述 : 记录上市公司发生特殊状态处理的信息，包含交易代码、变更后证券简称、公司状态等信息。
- 唯一键 : ID
