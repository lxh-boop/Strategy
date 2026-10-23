# ADR-0011：股票池筛选字段化——注册制维度表与值发现

日期：2026-10-23　状态：已采纳（grill 收口，用户逐项拍板）

## 背景

ADR-0006 的筛选工具把"行业"焊成一等来源：kind=industry 收申万一级名录（31 个名字内嵌工具描述，tool-specs.ts SCREEN_STOCK_POOL_SPEC），引擎侧 `WHERE level='L1'` JOIN `l1_code`（industry-engine.ts resolveIndustrySecurities）。二级行业数据全在库（sw_classify 134 个 L2 节点 + sw_member 逐行 l2_name）却筛不了——"一级"是实施收口，不是数据限制。名录内嵌描述与澄清回执两处，数据更新即腐烂；且名录进 prompt 与 ADR-0004"字典即路由、GLM 无感"的既定哲学相悖。

名录问题的解法因子域早已给出：GLM 从不知道"有哪些因子"起步，靠的是目录注入 + 字段工具 + 读数工具的发现链路，名录从未进过 prompt。行业取值是同一问题，用户拍板直接复用同一条链路，不另起炉灶。

## 决策

1. **筛选组字段化**：kind = field / index / list，industry 退役。field 组 = `{ table, field, values }`——工具与引擎不感知"行业"与"一级/二级"概念，粒度由字段名承载（l1_name/l2_name/l3_name）；池摘要只拼值（"白酒∩沪深300"），表名字段名不进展示层。
2. **可筛维度表注册制**：代码内注册表声明每张可筛表的 `{ 证券代码列, PIT 列 }`，首批仅 sw_member（in_date/out_date），注册只闸池来源。"池 = 离散归属、因子 = 连续打分"的域边界由此守住——因子表不进注册，按因子值筛池与回测排序/入场筛选语义不混淆。新增来源 = 注册一张表，GLM 侧零改动（表目录注入自动携带）。
3. **名录发现复用因子表链路，不新增工具**：表目录看表 → list_factor_fields 看列 → read_factor_data 去重读看值（单字段 DISTINCT + keyword 收窄，行业域表路由 industryReadTable 承接）→ screen_stock_pool 筛选。事实底座：read_factor_data 现状（200 行顶、无 WHERE/DISTINCT）枚举不了名录，去重读是复用链路的最小延伸，不是新链路。名录只活在查询结果里；工具描述只留用法与最小格式示例（三个常用指数代码，属示例非名录），全集名录一律不进描述与 prompt。
4. **盲筛失败指路不铺路**：值不存在时回执返回未知值清单 + 指向去重读的查询提示，不内嵌任何名录（industryClarificationGuide 的名录回执退役）。
5. **不留兼容**：池句柄本就本会话有效（ADR-0006 决策 2），kind=industry 存量规格无服务对象——`resolveIndustrySecurities` 的 L1 逻辑与工具描述名录整体删除，不做迁移。

## 后果

- 三处"行业"概念移除：工具描述名录、PoolGroup 类型、引擎 L1 解析与名录澄清指引。
- read_factor_data 增加去重读形态（DuckDB 行业域表承接；单字段、keyword LIKE、上限放宽到 500——值都是短标签，346 个 L3 名也在顶内，keyword 仍建议收窄）；字段发现零新增——表目录注入 + list_factor_fields 已路由 sw_member。
- 二级行业筛选即刻可用（如"白酒"= sw_member.l2_name），无需任何数据或字典新增。
- L1/L2 名称零碰撞（134 个 L2 名与 31 个 L1 名无重合），字段名承载粒度后歧义风险进一步归零。
- GLOSSARY 同步：股票池筛选/池规格词条改写，新增可筛维度表、值发现。
