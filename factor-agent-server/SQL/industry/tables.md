# 行业板块数据字典 —— 表描述

> 来源：Tushare Pro 接口实测下载（2026-10-17），字段描述按接口实际返回列整理，非通联字典原文。
> 字段级说明见 [sw_classify.md](sw_classify.md)、[sw_member.md](sw_member.md)、[stock_industry.md](stock_industry.md)、[dc_board_index.md](dc_board_index.md) 与 [dc_board_list.md](dc_board_list.md)。
> 刷新方式：`TUSHARE_TOKEN=<你的token> node download-industry.mjs`（token 仅走环境变量）。

## sw_classify（申万行业分类）

- 描述 : 申万 2021 行业分类标准全层级目录，覆盖一级、二级、三级共 511 个行业节点，经 parent_code 逐级挂接。一级行业共 31 个：交通运输、传媒、公用事业、农林牧渔、医药生物、商贸零售、国防军工、基础化工、家用电器、建筑材料、建筑装饰、房地产、有色金属、机械设备、汽车、煤炭、环保、电力设备、电子、石油石化、社会服务、纺织服饰、综合、美容护理、计算机、轻工制造、通信、钢铁、银行、非银金融、食品饮料。
- 唯一键 : index_code
- 数据文件 : sw2021_classify.csv

## sw_member（申万行业成分）

- 描述 : 个股申万行业归属的全量进出记录（在册 5918 行 is_new=Y + 已调出 2006 行 is_new=N），一、二、三级行业编码与名称齐全，in_date/out_date 支持 PIT 时点归属。行业筛选引擎的消费表。
- 唯一键 : ts_code,in_date,out_date
- 数据文件 : sw_member_current.csv + sw_member_historical.csv（导入时合并）

## stock_industry（个股基础信息）

- 描述 : 全部上市个股基础信息 5577 行，含 Tushare 口径 industry 行业字段；该口径与申万分类名不完全一致，仅作简明对照，严谨行业归属以申万成分表为准。
- 唯一键 : ts_code
- 数据文件 : stock_industry.csv

## dc_board_index（东财板块日行情）

- 描述 : 东方财富板块（行业板块、概念板块等）的日行情快照，含领涨股、涨跌幅、总市值与涨跌家数；接口单页上限 5000 行，当前覆盖最近 5 个交易日。
- 唯一键 : ts_code,trade_date
- 数据文件 : dc_board_index.csv

## dc_board_list（东财板块清单）

- 描述 : 东方财富板块静态清单共 1046 个板块，由 dc_board_index 按板块代码去重派生，用于板块代码与名称、类型的对照；重新下载后需同步再生。
- 唯一键 : ts_code
- 数据文件 : dc_board_list.csv

## 通用备注

- ths_industry（同花顺板块）当前 token 权限不足（错误码 40101），未下载；取得权限后可在 download-industry.mjs 中补充。
- 本目录数据为 CSV 备选源，未登记进上层 SQL/tables.md 白名单（不可被智能体直查）；未来若入库引擎，再行注册。
