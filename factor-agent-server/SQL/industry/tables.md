# 行业板块数据字典 —— 表描述

> 来源：Tushare Pro 接口实测下载（2026-10-17），字段描述按接口实际返回列整理，非通联字典原文。
> 字段级说明见 [sw2021_classify.md](sw2021_classify.md)、[sw_member_current.md](sw_member_current.md)、[sw_member_historical.md](sw_member_historical.md)、[stock_industry.md](stock_industry.md)、[dc_board_index.md](dc_board_index.md) 与 [dc_board_list.md](dc_board_list.md)。
> 刷新方式：`TUSHARE_TOKEN=<你的token> node download-industry.mjs`（token 仅走环境变量）。

## sw2021_classify（申万行业分类）

- 描述 : 申万 2021 行业分类标准全层级目录，覆盖一级、二级、三级共 511 个行业节点，经 parent_code 逐级挂接。
- 唯一键 : index_code
- 数据文件 : sw2021_classify.csv

## sw_member_current（申万行业成分·在册）

- 描述 : 当前在册的个股申万行业归属，一、二、三级行业编码与名称齐全，5918 行；in_date 为纳入日期，out_date 为空。
- 唯一键 : ts_code
- 数据文件 : sw_member_current.csv

## sw_member_historical（申万行业成分·已调出）

- 描述 : 已调出申万行业成分的历史记录，字段与在册表一致，2006 行；in_date 与 out_date 齐全，与在册表合并可按调仓日重建时点行业归属（PIT）。
- 唯一键 : ts_code,in_date,out_date
- 数据文件 : sw_member_historical.csv

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
