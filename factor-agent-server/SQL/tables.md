# 通联数据字典 —— 表描述

> 来源：通联离线数据字典 V1.6，以下文字均照录字典原文。
> 字段级说明见 [equ_factor_cf.md](equ_factor_cf.md)、[equ_factor_derive.md](equ_factor_derive.md) 与 [mkt_adjf.md](mkt_adjf.md)。

## equ_factor_cf（股票因子_现金流指标）

- 描述 : 该类别体现了公司的现金流信息，如经营活动产生的现金流量净额增长率，反映了公司的现金流增长是否健康。
- 唯一键 : SECURITY_ID_INT,TRADE_DATE

## equ_factor_derive（股票因子_衍生数据）

- 描述 : 这类因子是财报数据的衍生，如净利润的TTM数值、息税前净利润（EBIT）等。
- 唯一键 : SECURITY_ID_INT,TRADE_DATE

## mkt_adjf（股票前复权因子）

- 描述 : 获取沪深京股票用来调整历史行情的前复权因子数据，包含除权除息日、除权除息事项具体数据、本次复权因子、累积复权因子以及对应的生效日期区间。该因子用来调整历史行情，不作为预测使用，于除权除息日进行计算调整。只在发生分红、配股、股改事件的除权除息日才有复权因子记录。
- 唯一键 : EX_DIV_DATE,SECURITY_ID
