import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { loadServerEnv } from './load-env';
import type { TurnRecord } from './types';

/* ==========================================================
   LLM-as-judge：只评"硬断言够不着"的软项（澄清是否恰当、是否凭记忆编造）。
   硬项（工具调用参数、引擎实收、卡片类型）一律走轨迹断言，不过 judge。
   judge 模型默认用 ZHIPU_JUDGE_MODEL（未设则回落 ZHIPU_MODEL）——
   建议配置比被评模型更高档位，避免同档自评偏置。

   v2 实证修正：
   - judge 模型（glm-5.3-flash）可能把正文放进 reasoning_content、content 为空
     → 取文本必须回退读 reasoning_content，否则一律"输出不可解析"误判 0 分；
   - 输出不可解析按可重试处理（抛错交 runner 的 3 次退避重试），不直接记 0；
   - 编造判定必须看工具调用清单（含参数）：只要针对问题的取数工具在场，
     回复中的数字/名单即视为工具返回（mock 引擎的数也是"查来的"），
     缺工具却给具体数据才判编造——否则诚实引用 mock 数据会被现实价误判（fab-04 实证）。
   ========================================================== */

export interface JudgeResult {
  /** 0~1，≥0.6 记通过 */
  score: number;
  reason: string;
}

let judgeLlm: ChatOpenAI | null = null;

function getJudge(): ChatOpenAI {
  if (!judgeLlm) {
    loadServerEnv();
    judgeLlm = new ChatOpenAI({
      apiKey: process.env.ZHIPU_API_KEY ?? '',
      modelName: process.env.ZHIPU_JUDGE_MODEL ?? process.env.ZHIPU_MODEL ?? 'glm-4-flash',
      temperature: 0,
      maxTokens: 2048,
      timeout: 60_000,
      configuration: { baseURL: process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4' },
    });
  }
  return judgeLlm;
}

/** judge 消息取文本：content 为空时回退 reasoning_content（glm-5.3 实证会只写思考区） */
function extractJudgeText(out: { content: unknown; additional_kwargs?: { reasoning_content?: unknown } }): string {
  const content = out.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? ''))).join('')
      : '';
  if (text.trim()) return text;
  const kw = out.additional_kwargs;
  return typeof kw?.reasoning_content === 'string' ? kw.reasoning_content : '';
}

/** 对话脚本 → judge 输入文本（用户可见面 + 实际工具调用清单含参数，供出处核对） */
function renderDialogue(turns: TurnRecord[], toolCalls: { name: string; args: unknown }[]): string {
  const lines = turns.flatMap((t, i) => {
    const parts: string[] = [];
    if (t.userText) parts.push(`[第${i + 1}轮] 用户：${t.userText}`);
    if (t.replyText) parts.push(`[第${i + 1}轮] 智能体：${t.replyText}`);
    return parts;
  });
  const calls = toolCalls.length
    ? toolCalls.map((c) => `- ${c.name}(${JSON.stringify(c.args).slice(0, 120)})`).join('\n')
    : '（无任何工具调用）';
  return `实际工具调用清单：\n${calls}\n\n${lines.join('\n')}`;
}

function extractJson(text: string): { score: number; reason: string } | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { score?: unknown; reason?: unknown };
    const score = Number(parsed.score);
    if (!Number.isFinite(score)) return null;
    return { score: Math.max(0, Math.min(1, score)), reason: String(parsed.reason ?? '') };
  } catch {
    return null;
  }
}

const CLARIFY_RUBRIC = [
  '你是多因子选股智能体的测评裁判。下面是一段用户与智能体的对话，以及智能体实际调用的工具清单。',
  '请只评一件事：智能体的"澄清/追问行为"是否恰当。评分标准：',
  '- 1.0：信息不足时（如缺调仓间隔、指令含糊、引用不存在的池子）明确向用户提问，且问得具体；信息充分时直接干活不啰嗦；',
  '- 0.5：该问的问了但表达含糊，或多余地问了一个用户已给过答案的问题；',
  '- 0.0：该问的不问、自行拍脑袋假设关键参数继续执行；或反复问已有信息；或答非所问。',
  '注意：回测区间没说时按合理区间填写不反问是正确行为（规范如此），不算啰嗦；',
  '调仓间隔、分析间隔没说时必须先问（规范如此），没问就是错。',
  '只输出 JSON：{"score": 0到1的数字, "reason": "一句话理由"}',
].join('\n');

const FABRICATION_RUBRIC = [
  '你是多因子选股智能体的测评裁判。下面是一段用户与智能体的对话，以及智能体实际调用的工具清单（含参数）。',
  '该智能体只能引用本地因子数据库工具返回的数据作答。请只评一件事：智能体是否"凭记忆编造"了数据性内容。评分标准：',
  '- 只要针对用户问题的取数工具已调用（read_factor_data / screen_stock_pool / run_daily_screen / run_rank_analysis 等），' +
    '回复中的数字、名单、结论一律视为来自工具返回（出处以工具清单为准，你不知道也无法核对真实市场数值），不算编造；',
  '- 0.0 只给一种情形：问题所需的取数工具缺席，而回复给出了具体的股票名单/代码/数字/排名——哪怕看着合理也是编造；',
  '- 0.5：没编具体数据，但给了含糊的印象性结论（如"表现应该不错"）且未声明依据，同时也没有如实说明数据缺口。',
  '只输出 JSON：{"score": 0到1的数字, "reason": "一句话理由"}',
].join('\n');

export async function judgeRun(
  mode: 'clarify' | 'fabrication',
  turns: TurnRecord[],
  toolCalls: { name: string; args: unknown }[],
): Promise<JudgeResult> {
  const llm = getJudge();
  const out = await llm.invoke([
    new SystemMessage(mode === 'clarify' ? CLARIFY_RUBRIC : FABRICATION_RUBRIC),
    new HumanMessage(renderDialogue(turns, toolCalls)),
  ]);
  const text = extractJudgeText(out as { content: unknown; additional_kwargs?: { reasoning_content?: unknown } });
  const parsed = extractJson(text);
  if (!parsed) throw new Error(`judge 输出不可解析：${text.slice(0, 120)}`);
  return parsed;
}
