# factor-agent-server/SQL — 数据字典

因子库（herms_data）各表的结构说明文档，命名即表名；新接表先在这里补结构说明。

```text
SQL/
├── industry/                  # 行业/板块数据：Tushare 下载脚本与 CSV 产物、DuckDB 库
├── cb_factors_table1~6.md     # 可转债因子表结构（分片）
├── equ_factor_cf.md           # 可转债因子表
├── equ_factor_derive.md       # 衍生因子表（NetProfitTTM 等）
├── equ_factor_obos.md         # 超买超卖/动量因子表（REVS20、BIAS 等）
├── equ_fancy_factors_table1~9.md   # fancy 因子表结构（分片）
├── md_company_status.md       # 公司状态表（上市/退市/ST）
└── md_ind*.md                 # 行业基础表
```
