# 行业 / 板块数据（Tushare Pro 下载）

生成方式：`TUSHARE_TOKEN=<你的token> node download-industry.mjs`（token 只走环境变量，不入库不入文件）。

| 文件 | 接口 | 内容 |
|---|---|---|
| sw2021_classify.csv | index_classify(src=SW2021) | 申万 2021 行业分类全层级（L1/L2/L3，511 节点，含 parent_code） |
| sw_member_current.csv | index_member_all(is_new=Y) | 申万成分·在册（5918 行，个股 → L1/L2/L3 名称，in_date 起始） |
| sw_member_historical.csv | index_member_all(is_new=N) | 申万成分·已调出（2006 行，含 out_date） |
| stock_industry.csv | stock_basic | 全部上市个股基础信息（含 Tushare 口径 industry 字段，5577 行） |
| dc_board_index.csv | dc_index | 东财板块日行情快照（接口单页 5000 行上限，当前覆盖最近 5 个交易日） |
| dc_board_list.csv | 由 dc_board_index 去重 | 东财板块清单（ts_code / 名称 / 板块类型） |

注意事项：
- `ths_industry`（同花顺板块）当前 token 权限不足（40101），未下载。
- 申万成分 in_date/out_date 齐全，可支撑逐调仓日的时点行业归属（PIT）。
- 生成日期：2026-10-17。
