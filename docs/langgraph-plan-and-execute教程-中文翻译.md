# Plan-and-Execute（计划-执行）— LangGraphJS 官方教程中文翻译

> 原文：<https://github.com/langchain-ai/langgraphjs/blob/main/examples/plan-and-execute/plan-and-execute.ipynb>
>
> 译注以「译注：」标出，其余为原文全译。代码与原教程一致，仅注释译为中文。

---

## 什么是 Plan-and-Execute

本教程演示如何创建一个"计划-执行"（plan-and-execute）风格的智能体。设计思路主要来自
[Plan-and-Solve 论文](https://arxiv.org/abs/2305.04091)以及 [Baby-AGI](https://github.com/yoheinakajima/babyagi) 项目。

核心思想是：**先生成一个多步计划，然后逐项执行该计划**。每完成一项任务后，可以回头审视计划并按需修改。

这与典型的 [ReAct](https://arxiv.org/abs/2210.03629) 风格智能体（一次只想一步）形成对比。"计划-执行"风格的优势在于：

1. **显式的长期规划**——这一点即便是很强的 LLM 单靠逐步思考也很难做好；
2. **执行步骤可以用更小/更弱的模型**，只把更大/更强的模型留给规划步骤。

> 译注：图结构总览——
>
> ```
> START → planner(规划) → agent(执行一步) → replan(重规划) ─┬→ 已可直接回答 → END
>                          ↑                               └→ 还有剩余步骤 → agent
> ```

## 环境准备

首先安装所需依赖包。

```bash
npm install @langchain/langgraph @langchain/openai langchain @langchain/core @langchain/tavily
```

接着设置 API Key：OpenAI（本教程用的 LLM）和 Tavily（本教程用的搜索工具）。

```typescript
// process.env.OPENAI_API_KEY = "YOUR_API_KEY"
// process.env.TAVILY_API_KEY = "YOUR_API_KEY"
```

可选：设置 LangSmith 的 API Key 以开启链路追踪，可以获得一流的可观测性。

```typescript
// process.env.LANGCHAIN_TRACING_V2 = "true"
// process.env.LANGCHAIN_API_KEY = "YOUR_API_KEY"
// process.env.LANGCHAIN_PROJECT = "YOUR_PROJECT_NAME"
```

## 定义状态（State）

开始定义这个智能体要追踪的状态。

首先，需要追踪**当前计划**，用字符串列表表示；

其次，追踪**已执行过的步骤**，用元组列表表示（每个元组包含：步骤描述、该步骤的执行结果）；

最后，还需要两个状态：**最终回复**（response）和**原始目标**（input）。

```typescript
import { Annotation } from "@langchain/langgraph";

const PlanExecuteState = Annotation.Root({
  input: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "",        // 新值优先；无新值保留旧值
  }),
  plan: Annotation<string[]>({
    reducer: (x, y) => y ?? x ?? [],        // 计划：replan 节点每次整体重写
  }),
  pastSteps: Annotation<[string, string][]>({
    reducer: (x, y) => x.concat(y),         // 已完成步骤 [步骤, 结果]：追加式累积
  }),
  response: Annotation<string>({
    reducer: (x, y) => y ?? x,              // 最终回复：replan 判定"可以收工"时写入
  }),
});
```

> 译注：`plan` 的 reducer 是 `y ?? x`——节点返回新计划就整体覆盖，不返回就保留。这让"重规划"在状态层面只是**覆写一个字段**；`pastSteps` 则相反，永远 concat 追加，保证执行历史不被抹掉。

## 定义工具

先定义要用的工具。这个简单示例用 Tavily 内置的搜索工具。自定义工具也很容易，做法见
[官方文档](https://js.langchain.com/docs/modules/agents/tools/dynamic)。

```typescript
import { TavilySearch } from "@langchain/tavily";

const tools = [new TavilySearch({ maxResults: 3 })];
```

## 定义执行代理（Executor）

现在创建用来执行任务的执行代理。注意本例中每个任务都用同一个执行代理，但这**不是必须的**——不同任务可以换不同的执行器。

> 译注：`createReactAgent` 是 LangGraph 的预置构件，生成一个"自带工具循环"的子图（LLM ⇄ tools 反复往返直到不再调工具）。它作为**子代理嵌在"agent"节点里**——这就是上一轮讨论里"executor 是 subagent、replanner 不是"的出处。

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const agentExecutor = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools: tools,
});
```

单独试跑一次执行代理：

```typescript
import { HumanMessage } from "@langchain/core/messages";

await agentExecutor.invoke({
  messages: [new HumanMessage("who is the winner of the us open")],  // 谁是美网冠军
});
```

## 规划步骤（Planner）

接下来创建规划步骤——用函数调用（结构化输出）生成计划。

> 译注：用 zod schema 约束输出形状，"计划"在模型输出层面就是一个字符串数组，后续才能当作状态字段传递。

```typescript
import { z } from "zod";

const planObject = z.object({
  steps: z
    .array(z.string())
    .describe("要依次执行的各个步骤，必须按先后顺序排列"),
});
```

规划器的提示词——注意最后两句是防坑关键：每步必须信息自足、不许跳步：

```typescript
import { ChatPromptTemplate } from "@langchain/core/prompts";

const plannerPrompt = ChatPromptTemplate.fromTemplate(
  `针对给定的目标，制定一个简明的分步计划。
计划应由一个个独立任务组成，只要正确执行就能得出正确答案。不要添加多余的步骤。
最后一步的结果应当就是最终答案。确保每一步都具备所需的全部信息——不要跳步。

{objective}`,
);

const model = new ChatOpenAI({
  modelName: "gpt-4-0125-preview",
});

const structuredModel = model.withStructuredOutput(planObject);

const planner = plannerPrompt.pipe(structuredModel);   // 提示词 → 结构化输出，串成一条链
```

试跑规划器：

```typescript
await planner.invoke({
  objective: "what is the hometown of the current Australia open winner?",  // 现任澳网冠军的家乡是哪里？
});
```

## 重规划步骤（Re-Plan）

现在创建根据上一步执行结果重做计划的步骤。

> 译注：这是全教程最精妙的一处——**不用 union schema，而是伪造两个空工具**（`plan` 和 `response`）绑给模型，让模型通过"选择调用哪个工具 + 填参数"来表达二选一：
> - 选 `response` → 计划已完成，直接给出给用户的最终回复；
> - 选 `plan` → 给出修订后的剩余步骤。
>
> 再用 `JsonOutputToolsParser` 把工具调用解析回普通对象。这是 `withStructuredOutput(union)` 尚不普及年代的等价写法；新代码直接用 `z.union` + `withStructuredOutput` 即可，思路相同。

```typescript
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";
import { tool } from "@langchain/core/tools";

const responseObject = z.object({
  response: z.string().describe("给用户的回复。"),
});

const responseTool = tool(() => {}, {
  name: "response",
  description: "回复用户。",
  schema: responseObject,
});

const planTool = tool(() => {}, {
  name: "plan",
  description: "该工具用于规划后续要执行的步骤。",
  schema: planObject,                       // 复用规划器同款的 steps 数组 schema
});

const replannerPrompt = ChatPromptTemplate.fromTemplate(
  `针对给定的目标，制定一个简明的分步计划。
计划应由一个个独立任务组成，只要正确执行就能得出正确答案。不要添加多余的步骤。
最后一步的结果应当就是最终答案。确保每一步都具备所需的全部信息——不要跳步。

你的目标是：
{input}

你的原始计划是：
{plan}

你目前已完成的步骤及其结果：
{pastSteps}

请据此更新你的计划。如果不再需要任何步骤、可以直接回复用户，那就用 'response' 函数给出回复。
否则请填好计划。
只添加**尚未完成**的步骤，不要把已完成的步骤放回计划里。`,
);

const parser = new JsonOutputToolsParser();
const replanner = replannerPrompt
  .pipe(
    new ChatOpenAI({ model: "gpt-4o" }).bindTools([
      planTool,
      responseTool,
    ]),
  )
  .pipe(parser);                            // 输出形如 [{ type: "plan"|"response", args: {...} }]
```

## 创建图（Graph）

现在可以把图搭起来了！

> 译注：三个节点对应三段逻辑，条件边挂在 replan 之后。`executeStep` 每次只取 `plan[0]` 执行、执行完把计划砍掉头部——"游标"就是这么实现的；`shouldEnd` 只看 `response` 通道有没有值。

```typescript
import { END, START, StateGraph } from "@langchain/langgraph";
import { RunnableConfig } from "@langchain/core/runnables";

// 执行一步：取计划第一项交给执行代理跑，结果连同步骤记入 pastSteps，计划砍掉第一项
async function executeStep(
  state: typeof PlanExecuteState.State,
  config?: RunnableConfig,
): Promise<Partial<typeof PlanExecuteState.State>> {
  const task = state.plan[0];
  const input = {
    messages: [new HumanMessage(task)],
  };
  const { messages } = await agentExecutor.invoke(input, config);

  return {
    pastSteps: [[task, messages[messages.length - 1].content.toString()]],  // [步骤, 执行结果]
    plan: state.plan.slice(1),                                              // 弹出已执行的第一项
  };
}

// 规划：把原始目标交给规划器，产出初始计划
async function planStep(
  state: typeof PlanExecuteState.State,
): Promise<Partial<typeof PlanExecuteState.State>> {
  const plan = await planner.invoke({ objective: state.input });
  return { plan: plan.steps };
}

// 重规划：带着目标、原计划、已完成步骤问 replanner——收工（response）还是改计划（plan）
async function replanStep(
  state: typeof PlanExecuteState.State,
): Promise<Partial<typeof PlanExecuteState.State>> {
  const output = await replanner.invoke({
    input: state.input,
    plan: state.plan.join("\n"),
    pastSteps: state.pastSteps
      .map(([step, result]) => `${step}: ${result}`)
      .join("\n"),
  });
  const toolCall = output[0];

  if (toolCall.type == "response") {
    return { response: toolCall.args?.response };   // 收工：写入最终回复
  }

  return { plan: toolCall.args?.steps };            // 继续：整体覆写剩余计划
}

// 条件边：response 有值 → 结束；没有 → 回执行节点
function shouldEnd(state: typeof PlanExecuteState.State) {
  return state.response ? "true" : "false";
}

const workflow = new StateGraph(PlanExecuteState)
  .addNode("planner", planStep)
  .addNode("agent", executeStep)
  .addNode("replan", replanStep)
  .addEdge(START, "planner")
  .addEdge("planner", "agent")
  .addEdge("agent", "replan")
  .addConditionalEdges("replan", shouldEnd, {
    true: END,
    false: "agent",
  });

// 最后编译！
// 编译成 LangChain Runnable，
// 之后就可以像其他任何 runnable 一样使用它
const app = workflow.compile();
```

运行整图（流式输出每一步的状态变化）：

```typescript
const config = { recursionLimit: 50 };   // 循环保护：最多 50 轮，防止重规划死循环
const inputs = {
  input: "what is the hometown of the 2024 Australian open winner?",  // 2024 澳网冠军的家乡是哪里？
};

for await (const event of await app.stream(inputs, config)) {
  console.log(event);
}
```

> #### 点击[这里](https://smith.langchain.com/public/5bb4f582-d111-417d-ba91-29bcced272bb/r)查看本例的 LangSmith 完整追踪。

---

## 译注：对照你项目的实现

| 教程 | 你的 langgraph-agent.service.ts |
|---|---|
| `planner` 节点：LLM 生成计划 | 无——流程固定四步，用 system prompt 写死流程指令代替 |
| `agent` 节点：`createReactAgent` 子代理执行一步 | `agent`+`tools` 两节点组成的 ReAct 循环本体，既是执行器也是"隐形 replanner" |
| `replan` 节点：LLM 每步后改写计划 | 无独立节点——`guard()` 把报错回灌给模型自纠、`ClarificationSignal` 转向用户提问 |
| `pastSteps` 通道 | `messages` 通道（concat reducer），轨迹即历史 |
| `shouldEnd` 看 `response` 通道 | 条件边看最后一条消息有无 `tool_calls` |
| `recursionLimit: 50` | `recursionLimit: 15` |
