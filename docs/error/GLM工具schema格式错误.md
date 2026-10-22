# GLM 工具调用 400：tools[N].type / function 不能为空

> **版本**：v1.0（2026-10-16 初版）
> **状态**：已修复（新增工具 schema 规范沉淀）
> **关联文档**：[确认门批准实现](确认门批准实现.md)、[前端弹窗说明](前端弹窗说明.md)（确认文本协议已泛化，见本文 §5）

---

## 一、现象（日志实锤时间线）

2026-10-16 排名分析接线后（`tool-specs.ts` 新增 `run_rank_analysis` / `run_factor_correlation` 两工具），**任何提问（包括"你好"）智能体都失败**：

| 时间 | GLM 返回 | 所处阶段 |
|---|---|---|
| 17:41 | `400 tools[4].type: type cannot be empty` | 初版 schema：字段平铺、无 `type` |
| 17:44-17:48 | `400 tools[4].function 不能为空` | 补了 `type`，但仍是平铺（缺 `function` 包裹） |

关键观察：**"你好"也失败**——bindTools 的工具清单随每次请求全量发送，清单本身被 GLM 拒绝，图根本没启动，与提问内容无关。

## 二、根因

工具 schema 存在两种写法，GLM（OpenAI 兼容协议）**只认嵌套格式**：

```ts
// ✅ 正确（老四工具的实际结构，list_factor_tables 等）
{
  type: 'function' as const,
  function: {
    name: 'run_rank_analysis',
    description: '…',
    parameters: { type: 'object', properties: {…}, required: […] },
  },
}

// ❌ 错误（新增两工具的初版：字段平铺在顶层）
{
  type: 'function' as const,
  name: 'run_rank_analysis',
  description: '…',
  parameters: { … },
}
```

两个放大因素：

1. **LangChain 透传不救场**：`bindTools` 的转换器（`_convertToOpenAITool`，`@langchain/core/utils/function_calling`）对普通对象**原样透传**，不会自动把平铺格式包装成嵌套——格式对不对全靠写的人。
2. **错误下标 = 第一个不合格工具**：`tools[N]` 的 N 是绑定顺序下标（0=list_factor_tables … 4=run_rank_analysis, 5=run_factor_correlation）。老四工具格式正确所以校验通过，清单走到第 5 个才报错——错误号恰好指认了新工具。

## 三、诊断过程（实证对照，不打库不进图）

日志定位到 GLM 400 后，用 `.env` 的 key 直接 POST `chat/completions` 最小请求，四组对照一次分辨"格式问题还是工具内容问题"：

| 组 | tools 内容 | 结果 |
|---|---|---|
| A | 扁平 × 前 4 个 | 400 `tools[0].function 不能为空` |
| B | 扁平 × 前 4 + rank 扁平 | 400 `tools[0]` |
| C | 前 4 扁平 + rank 嵌套 | 400 `tools[0]` |
| D | **全部 6 个嵌套** | **200 OK** |

结论：**嵌套格式 200**；平铺格式从第 1 个工具就不合格——也反证了老四工具从来都是嵌套格式（否则回测不可能跑通）。

## 四、修复

- 两个新 schema 重写为嵌套结构（照抄 `run_strategy_backtest` 的形状）
- 连带修复：确认挂起文本按 interrupt 类型分流——分析确认的首行为 `将按以下参数执行排名分析（因子分段有效性评估）：`（原来会误标"策略回测"），`formatConfirmText` 增加 kind 参数
- 验证：tsc 干净；166 用例全绿（含新增"排名分析确认→执行→出卡"真图用例）；server 重启后待用户重试

## 五、规范（新增工具 schema 必读）

1. **结构必须嵌套**：`{ type: 'function', function: { name, description, parameters } }`——照抄现有任一 spec，不要自创平铺写法
2. **错误信息对照**：
   - `type cannot be empty` / `type 不能为空` → 缺顶层 `type: 'function'`
   - `function 不能为空` → 有 `type` 但缺 `function` 包裹（name/description/parameters 平铺在顶层）
3. LangChain bindTools 对普通对象透传，**不要指望它纠正格式**
4. 确认门文本协议已随本修复泛化：首行 `将按以下参数执行<类型>：`（不再限于回测），前端 `parseConfirmGate` 正则同步泛化为 `/^将按以下参数执行[^：]+：/`

---

## 版本历史

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-16 | 初版：排名分析接线引入的 schema 格式错误复盘 + 新增工具规范 |
