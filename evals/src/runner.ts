import * as fs from 'node:fs';
import * as path from 'node:path';
import { EvalHarness } from './harness';
import { judgeRun } from './judges';
import { subsetMatch } from './match';
import type { Check, EvalTask, RunTrajectory, TaskStep, TurnRecord } from './types';

/* ==========================================================
   跑批器：单任务跑一次（脚本化步骤 + 检查 + judge），批量 = 任务 × k 次顺序执行。

   协议校验是行为信号的一部分：脚本预期继续对话而模型弹了确认门（或反之）
   直接判失败——两种情况都是真实用户会遇到的交互偏差。
   ========================================================== */

export interface CheckResult {
  id: string;
  type: string;
  pass: boolean;
  detail: string;
}

export interface JudgeOutcome {
  score: number;
  reason: string;
  pass: boolean;
}

export const JUDGE_PASS_SCORE = 0.6;

export interface SingleRun {
  runIndex: number;
  trajectory: RunTrajectory;
  checks: CheckResult[];
  judge?: JudgeOutcome;
  /** 脚本协议偏差（如"脚本想继续说话但模型弹了确认门"） */
  protocolViolations: string[];
  success: boolean;
}

export interface TaskResult {
  task: EvalTask;
  runs: SingleRun[];
  passCount: number;
  /** pass^k：k 次全部成功（τ²-bench 口径） */
  passK: boolean;
}

function allToolCalls(traj: RunTrajectory): { name: string; args: unknown }[] {
  return traj.rounds.flatMap((r) => r.toolCalls);
}

export function evaluateChecks(checks: Check[], traj: RunTrajectory): CheckResult[] {
  const tools = allToolCalls(traj);
  const toolNames = new Set(tools.map((t) => t.name));
  const replyTexts = traj.turns.map((t) => t.replyText);
  return checks.map((check) => {
    switch (check.type) {
      case 'toolCall': {
        const matches = tools.filter((t) => t.name === check.name);
        const times = matches.length;
        if (check.maxTimes !== undefined && times > check.maxTimes) {
          return { id: check.id, type: check.type, pass: false, detail: `${check.name} 调用 ${times} 次 > maxTimes ${check.maxTimes}` };
        }
        const min = check.minTimes ?? 1;
        if (times < min) {
          return { id: check.id, type: check.type, pass: false, detail: `${check.name} 调用 ${times} 次 < minTimes ${min}` };
        }
        if (check.argsContains !== undefined && !matches.some((m) => subsetMatch(m.args, check.argsContains))) {
          return {
            id: check.id, type: check.type, pass: false,
            detail: `${check.name} 无一次调用参数包含期望子集 ${JSON.stringify(check.argsContains)}；实际参数：${matches.map((m) => JSON.stringify(m.args)).join(' | ').slice(0, 600)}`,
          };
        }
        return { id: check.id, type: check.type, pass: true, detail: `${check.name} × ${times}` };
      }
      case 'engineCall': {
        const matches = traj.engineCalls.filter((c) => c.mock === check.mock && c.method === check.method);
        const times = matches.length;
        if (check.times !== undefined && times !== check.times) {
          return { id: check.id, type: check.type, pass: false, detail: `引擎 ${check.mock}.${check.method} 实收 ${times} 次 ≠ 期望 ${check.times}` };
        }
        if (check.minTimes !== undefined && times < check.minTimes) {
          return { id: check.id, type: check.type, pass: false, detail: `引擎 ${check.mock}.${check.method} 实收 ${times} 次 < minTimes ${check.minTimes}` };
        }
        if (check.maxTimes !== undefined && times > check.maxTimes) {
          return { id: check.id, type: check.type, pass: false, detail: `引擎 ${check.mock}.${check.method} 实收 ${times} 次 > maxTimes ${check.maxTimes}` };
        }
        if (check.argsContains !== undefined && !matches.some((m) => subsetMatch(m.args, check.argsContains))) {
          return {
            id: check.id, type: check.type, pass: false,
            detail: `引擎 ${check.mock}.${check.method} 无一次实参包含期望子集 ${JSON.stringify(check.argsContains)}；实际：${matches.map((m) => JSON.stringify(m.args)).join(' | ').slice(0, 600)}`,
          };
        }
        return { id: check.id, type: check.type, pass: true, detail: `引擎 ${check.mock}.${check.method} × ${times}` };
      }
      case 'requiredTools': {
        const missing = check.names.filter((n) => !toolNames.has(n));
        return missing.length
          ? { id: check.id, type: check.type, pass: false, detail: `缺少必需工具调用：${missing.join(', ')}；实际调用：${[...toolNames].join(', ') || '（无）'}` }
          : { id: check.id, type: check.type, pass: true, detail: check.names.join(', ') };
      }
      case 'forbiddenTools': {
        const hit = check.names.filter((n) => toolNames.has(n));
        return hit.length
          ? { id: check.id, type: check.type, pass: false, detail: `出现禁止的工具调用：${hit.join(', ')}` }
          : { id: check.id, type: check.type, pass: true, detail: '无' };
      }
      case 'replyContains':
        return replyTexts.some((t) => t.includes(check.text))
          ? { id: check.id, type: check.type, pass: true, detail: check.text }
          : { id: check.id, type: check.type, pass: false, detail: `回复中未出现「${check.text}」；实际：${replyTexts.join(' | ').slice(0, 300)}` };
      case 'replyNotContains': {
        const hit = replyTexts.find((t) => t.includes(check.text));
        return hit === undefined
          ? { id: check.id, type: check.type, pass: true, detail: '未出现' }
          : { id: check.id, type: check.type, pass: false, detail: `回复不应出现「${check.text}」：${hit.slice(0, 200)}` };
      }
      case 'confirmAsked': {
        const n = traj.turns.filter((t) => t.confirmPending).length;
        const min = check.minTimes ?? 1;
        return n >= min
          ? { id: check.id, type: check.type, pass: true, detail: `确认门挂起 ${n} 次` }
          : { id: check.id, type: check.type, pass: false, detail: `确认门挂起 ${n} 次 < ${min}` };
      }
      case 'noConfirm':
        return traj.turns.some((t) => t.confirmPending)
          ? { id: check.id, type: check.type, pass: false, detail: '不应弹确认门但挂起了' }
          : { id: check.id, type: check.type, pass: true, detail: '未挂起' };
      case 'noEngineRun':
        return traj.engineCalls.length === 0
          ? { id: check.id, type: check.type, pass: true, detail: '引擎零调用' }
          : { id: check.id, type: check.type, pass: false, detail: `不应进引擎但实收 ${traj.engineCalls.length} 次：${traj.engineCalls.map((c) => `${c.mock}.${c.method}`).join(', ')}` };
      case 'cardType':
        return traj.turns.some((t) => t.cardType === check.cardType)
          ? { id: check.id, type: check.type, pass: true, detail: check.cardType }
          : { id: check.id, type: check.type, pass: false, detail: `未产出 ${check.cardType} 卡片；实际：${traj.turns.map((t) => t.cardType ?? '无').join(', ')}` };
      default:
        return { id: (check as { id: string }).id, type: 'unknown', pass: false, detail: `未知检查类型：${JSON.stringify(check)}` };
    }
  });
}

/** 跑单个任务的一次执行。任何异常都收敛进返回值（跑批绝不被单任务打断） */
export async function runSingle(task: EvalTask, runIndex: number): Promise<SingleRun> {  const harness = EvalHarness.create({ failFirstBacktests: task.failFirstBacktests });
  const t0 = Date.now();
  const violations: string[] = [];
  try {
    const conversation = harness.newConversation(task.id, runIndex, task.steps.find((s) => s.seed)?.seed);
    const turns: TurnRecord[] = [];
    for (let i = 0; i < task.steps.length; i++) {
      const step: TaskStep = task.steps[i];
      if (step.confirm !== undefined) {
        // 确认答复步骤 = 真实用户在输入框打字：挂起时按确认门协议路由（'确认'/'授权调优'/feedback），
        // 未挂起时就是一条普通消息——两种情形生产侧都有明确语义，不构成协议偏差，成败交给检查。
        const pending = harness.hasPendingConfirm(conversation.id);
        if (pending) {
          // plain「确认」= 循环语义：提案被白名单快检打回后模型会自纠重发、再次弹确认窗——
          // 真实用户就是再点一次确认，所以挂起就再答（上限 5 次）。
          // feedback / 授权调优 = 单次语义：重复回答语义就错了（改参会反复取消，授权不能反复触发）。
          const plain = step.confirm === '确认' || step.confirm === '确认执行';
          let cycles = 0;
          while (harness.hasPendingConfirm(conversation.id)) {
            if (!plain && cycles > 0) break;
            if (cycles >= 5) {
              violations.push(`第${i + 1}步：「${step.confirm}」循环回答超过 5 次仍未脱离确认门`);
              break;
            }
            turns.push(await harness.runTurn(conversation, step.confirm));
            cycles += 1;
          }
        } else {
          turns.push(await harness.runTurn(conversation, step.confirm));
        }
        continue;
      }
      turns.push(await harness.runTurn(conversation, step.user as string));
    }
    const trajectory = harness.trajectory(task.id, runIndex, Date.now() - t0);
    trajectory.turns = turns;
    const checks = evaluateChecks(task.checks, trajectory);
    let judge: JudgeOutcome | undefined;
    if (task.judge) {
      // judge 输入要带上种子上下文：seed 里的历史轮不在执行 turns 里，
      // 不带的话 judge 看不到"授权调优"之前约定过的参数，会把正常执行误判成拍脑袋（rt-09 实证）
      const seedTurns: TurnRecord[] = (task.steps.find((s) => s.seed)?.seed ?? []).map((s) => ({
        userText: s.role === 'user' ? s.bubble : '',
        replyText: s.role === 'agent' ? s.bubble : '',
        confirmPending: false,
        durationMs: 0,
      }));
      let lastJudgeError = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await judgeRun(
            task.category === 'fabrication' ? 'fabrication' : 'clarify',
            [...seedTurns, ...turns],
            trajectory.rounds.flatMap((r2) => r2.toolCalls),
          );
          judge = { ...r, pass: r.score >= JUDGE_PASS_SCORE };
          break;
        } catch (error) {
          // 输出不可解析 / 上游 429 都走这里：退避后重试
          lastJudgeError = String(error);
          await sleep(30_000 * (attempt + 1));
        }
      }
      if (!judge) judge = { score: 0, reason: `judge 调用失败（重试 3 次后放弃）：${lastJudgeError}`, pass: false };
    }
    return {
      runIndex,
      trajectory,
      checks,
      judge,
      protocolViolations: violations,
      success: violations.length === 0 && checks.every((c) => c.pass) && (judge?.pass ?? true),
    };
  } catch (error) {
    const trajectory = harness.trajectory(task.id, runIndex, Date.now() - t0, String(error));
    return {
      runIndex,
      trajectory,
      checks: [],
      protocolViolations: violations,
      success: false,
    };
  } finally {
    harness.dispose();
  }
}

export interface BatchOptions {
  onProgress?: (msg: string) => void;
  /** 断点续跑状态文件：每完成一个任务增量落盘；重启时已有结果的任务直接跳过 */
  stateFile?: string;
}

/** 单 run 看门狗：GLM 调用自带 60s 超时，但 v3 实证仍可能整体挂死（进程被外部硬杀前 71 分钟无输出）。
 *  超时的 run 记为失败（error=watchdog），批次继续——测量不能被单个 run 拖死 */
const RUN_WATCHDOG_MS = 8 * 60 * 1000;

function withWatchdog(p: Promise<SingleRun>, taskId: string, runIndex: number): Promise<SingleRun> {
  return Promise.race([
    p,
    new Promise<SingleRun>((resolve) =>
      setTimeout(
        () =>
          resolve({
            runIndex,
            trajectory: {
              taskId, runIndex, rounds: [], turns: [], engineCalls: [], wallMs: RUN_WATCHDOG_MS,
              error: `watchdog 超时（${RUN_WATCHDOG_MS / 60000} 分钟）——疑似 GLM 调用挂死`,
            },
            checks: [],
            protocolViolations: [],
            success: false,
          }),
        RUN_WATCHDOG_MS,
      ),
    ),
  ]);
}

export async function runBatch(tasks: EvalTask[], k: number, opts: BatchOptions = {}): Promise<TaskResult[]> {
  const { onProgress, stateFile } = opts;
  const results: TaskResult[] = [];
  const done = new Map<string, TaskResult>();
  if (stateFile && fs.existsSync(stateFile)) {
    try {
      const prior = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as TaskResult[];
      for (const r of prior) if (r.runs.length === k) done.set(r.task.id, r);
      onProgress?.(`断点续跑：状态文件已有 ${done.size} 个任务的完整结果，跳过`);
    } catch {
      onProgress?.('断点状态文件不可读，全量重跑');
    }
  }
  const persist = (): void => {
    if (!stateFile) return;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(results, null, 2), 'utf8');
  };
  for (const task of tasks) {
    const prior = done.get(task.id);
    if (prior) {
      results.push(prior);
      continue;
    }
    const runs: SingleRun[] = [];
    for (let i = 0; i < k; i++) {
      onProgress?.(`[${task.id}] run ${i + 1}/${k} …`);
      runs.push(await withWatchdog(runWithRetry(task, i + 1, onProgress), task.id, i + 1));
      onProgress?.(`[${task.id}] run ${i + 1}/${k} → ${runs[i].success ? '通过' : '未过'}`);
      // 节流：实测单消费者 1 req/s 全过（2026-10-23 突发探测），默认 3s/run 在安全线内；
      // 与开发服务器共用账号或升级批量时用 EVAL_THROTTLE_MS 调大
      await sleep(Number(process.env.EVAL_THROTTLE_MS ?? 3_000));
    }
    const passCount = runs.filter((r) => r.success).length;
    results.push({ task, runs, passCount, passK: passCount === k });
    persist();
  }
  if (stateFile && fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true });
  return results;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * LLM 降级重试：429 限流等上游故障会让 agent 整轮返回失败文案（无工具调用），
 * 那是测量基础设施的噪声不是模型行为——带退避整轮重跑（换全新 harness），最多 2 次。
 * 判据：任一轮回复含生产侧失败文案前缀，或 judge 调用失败（不可解析/上游错误）。
 */
async function runWithRetry(task: EvalTask, runIndex: number, onProgress?: (msg: string) => void): Promise<SingleRun> {
  let run = await runSingle(task, runIndex);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const agentDegraded = run.trajectory.turns.some((t) => t.replyText.includes('回复生成失败'));
    const judgeDegraded = run.judge?.reason.includes('judge 调用失败') ?? false;
    if (!agentDegraded && !judgeDegraded) return run;
    const backoff = 30_000 * attempt;
    onProgress?.(`[${task.id}] run ${runIndex} 检测到 LLM 降级（agent=${agentDegraded} judge=${judgeDegraded}），${backoff / 1000}s 后整轮重试（${attempt}/2）`);
    await sleep(backoff);
    run = await runSingle(task, runIndex);
  }
  return run;
}
