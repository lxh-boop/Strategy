import type { SingleRun, TaskResult } from './runner';
import type { TaskCategory } from './types';

/* ==========================================================
   指标计算：把 run 结果聚合成指标卡五项。
   口径：
   - 任务完成率 pass^k = 任务级：k 次运行全部成功（τ²-bench 口径），全体任务一并报、分类别再报；
   - 参数口径正确率 = calibration 类 run 级：该 run 的全部 toolCall/engineCall 检查通过的比例
     （比任务成功更聚焦参数本身，不因软项失败而稀释）；
   - 编造率 = fabrication 类 run 级失败比例（run 成功 = 必需工具在场 + judge 判不编造）；
   - 澄清恰当率 = clarification 类 judge 分均值（0~1）；
   - 成本 = 全体 run 均值：LLM 轮数、工具调用次数、token、墙钟秒。
   ========================================================== */

export interface CategoryStat {
  tasks: number;
  runCount: number;
  runPassRate: number;
  passKRate: number;
}

export interface Scorecard {
  label: string;
  generatedAt: string;
  model: string;
  judgeModel: string;
  k: number;
  taskCount: number;
  totalRuns: number;
  overall: { taskPassKRate: number; runPassRate: number };
  categories: Record<string, CategoryStat>;
  calibrationArgAccuracy: number | null;
  fabricationRate: number | null;
  clarifyJudgeAvg: number | null;
  cost: {
    avgRounds: number;
    avgToolCalls: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgWallSec: number;
  };
}

function argChecksPass(run: SingleRun): boolean {
  const argChecks = run.checks.filter((c) => c.type === 'toolCall' || c.type === 'engineCall');
  return argChecks.length > 0 && argChecks.every((c) => c.pass);
}

export function aggregate(label: string, results: TaskResult[], k: number): Scorecard {
  const allRuns = results.flatMap((r) => r.runs);
  const runPassRate = allRuns.length ? allRuns.filter((r) => r.success).length / allRuns.length : 0;
  const passKRate = results.length ? results.filter((r) => r.passK).length / results.length : 0;

  const categories: Record<string, CategoryStat> = {};
  const byCategory = new Map<TaskCategory, TaskResult[]>();
  for (const r of results) {
    const list = byCategory.get(r.task.category) ?? [];
    list.push(r);
    byCategory.set(r.task.category, list);
  }
  for (const [category, list] of byCategory) {
    const runs = list.flatMap((r) => r.runs);
    categories[category] = {
      tasks: list.length,
      runCount: runs.length,
      runPassRate: runs.length ? runs.filter((r) => r.success).length / runs.length : 0,
      passKRate: list.length ? list.filter((r) => r.passK).length / list.length : 0,
    };
  }

  const calibRuns = byCategory.get('calibration')?.flatMap((r) => r.runs) ?? [];
  const fabRuns = byCategory.get('fabrication')?.flatMap((r) => r.runs) ?? [];
  const clarifyScores = byCategory
    .get('clarification')
    ?.flatMap((r) => r.runs)
    .filter((r) => r.judge !== undefined)
    .map((r) => r.judge!.score) ?? [];

  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return {
    label,
    generatedAt: new Date().toISOString(),
    model: process.env.ZHIPU_MODEL ?? 'glm-4-flash',
    judgeModel: process.env.ZHIPU_JUDGE_MODEL ?? process.env.ZHIPU_MODEL ?? 'glm-4-flash',
    k,
    taskCount: results.length,
    totalRuns: allRuns.length,
    overall: { taskPassKRate: passKRate, runPassRate },
    categories,
    calibrationArgAccuracy: calibRuns.length ? calibRuns.filter(argChecksPass).length / calibRuns.length : null,
    fabricationRate: fabRuns.length ? 1 - fabRuns.filter((r) => r.success).length / fabRuns.length : null,
    clarifyJudgeAvg: clarifyScores.length ? avg(clarifyScores) : null,
    cost: {
      avgRounds: avg(allRuns.map((r) => r.trajectory.rounds.length)),
      avgToolCalls: avg(allRuns.map((r) => r.trajectory.rounds.reduce((s, r2) => s + r2.toolCalls.length, 0))),
      avgInputTokens: avg(allRuns.map((r) => r.trajectory.rounds.reduce((s, r2) => s + (r2.inputTokens ?? 0), 0))),
      avgOutputTokens: avg(allRuns.map((r) => r.trajectory.rounds.reduce((s, r2) => s + (r2.outputTokens ?? 0), 0))),
      avgWallSec: avg(allRuns.map((r) => r.trajectory.wallMs / 1000)),
    },
  };
}
