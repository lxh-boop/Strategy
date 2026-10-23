import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Scorecard } from './metrics';
import type { TaskResult } from './runner';

const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export function renderScorecardMd(scorecard: Scorecard, results: TaskResult[]): string {
  const lines: string[] = [];
  lines.push(`# 智能体测评指标卡 — ${scorecard.label}`);
  lines.push('');
  lines.push(`- 生成时间：${scorecard.generatedAt}`);
  lines.push(`- 被评模型：${scorecard.model}（judge：${scorecard.judgeModel}）`);
  lines.push(`- 任务数：${scorecard.taskCount}，总运行：${scorecard.totalRuns}（每任务 k=${scorecard.k}）`);
  lines.push('');
  lines.push('## 五项指标');
  lines.push('');
  lines.push('| 指标 | 值 | 口径 |');
  lines.push('|---|---|---|');
  lines.push(`| 任务完成率（pass^${scorecard.k}） | ${pct(scorecard.overall.taskPassKRate)} | 全部 ${scorecard.k} 次运行成功的任务占比（run 级通过率 ${pct(scorecard.overall.runPassRate)}） |`);
  lines.push(`| 参数口径正确率 | ${pct(scorecard.calibrationArgAccuracy)} | 口径类任务 run 级：工具调用参数/引擎实参检查全部通过 |`);
  lines.push(`| 编造率 | ${pct(scorecard.fabricationRate)} | 编造诱导任务 run 级失败比例（缺必需工具调用，或 judge 判编造） |`);
  lines.push(`| 澄清恰当率 | ${scorecard.clarifyJudgeAvg === null ? '—' : scorecard.clarifyJudgeAvg.toFixed(2)} | 澄清类任务 judge 均分（0~1，≥0.6 记过） |`);
  lines.push(
    `| 单任务成本 | ${scorecard.cost.avgRounds.toFixed(1)} 轮 · ${scorecard.cost.avgToolCalls.toFixed(1)} 次工具调用 · ` +
      `${scorecard.cost.avgInputTokens.toFixed(0)}/${scorecard.cost.avgOutputTokens.toFixed(0)} tokens · ${scorecard.cost.avgWallSec.toFixed(1)}s | run 均值（输入/输出 token） |`,
  );
  lines.push('');
  lines.push('## 分类别');
  lines.push('');
  lines.push('| 类别 | 任务数 | run 数 | run 通过率 | pass^k |');
  lines.push('|---|---|---|---|---|');
  for (const [cat, s] of Object.entries(scorecard.categories)) {
    lines.push(`| ${cat} | ${s.tasks} | ${s.runCount} | ${pct(s.runPassRate)} | ${pct(s.passKRate)} |`);
  }
  lines.push('');
  lines.push('## 任务明细');
  lines.push('');
  lines.push('| 任务 | 标题 | 通过 run | pass^k | 失败要点（各失败 run 的首个原因） |');
  lines.push('|---|---|---|---|---|');
  for (const r of results) {
    const failReasons = r.runs
      .filter((run) => !run.success)
      .map((run) => {
        const reasons = [
          ...run.protocolViolations,
          ...run.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`),
          ...(run.judge && !run.judge.pass ? [`judge(${run.judge.score.toFixed(2)}): ${run.judge.reason}`] : []),
          ...(run.trajectory.error ? [`执行异常: ${run.trajectory.error.slice(0, 120)}`] : []),
        ];
        return reasons.length ? `${reasons[0].slice(0, 150)}` : '未知原因';
      });
    lines.push(
      `| ${r.task.id} | ${r.task.title} | ${r.passCount}/${scorecard.k} | ${r.passK ? '✅' : '❌'} | ${failReasons.length ? [...new Set(failReasons)].join(' ｜ ').slice(0, 400) : '—'} |`,
    );
  }
  lines.push('');
  lines.push('> 口径细节与任务清单见 evals/README.md；本卡由 evals 套件自动生成。');
  return lines.join('\n');
}

export function writeReport(reportsDir: string, label: string, scorecard: Scorecard, results: TaskResult[]): { mdPath: string; jsonPath: string } {
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `scorecard-${label}-${stamp}`;
  const mdPath = path.join(reportsDir, `${base}.md`);
  const jsonPath = path.join(reportsDir, `${base}.json`);
  fs.writeFileSync(mdPath, renderScorecardMd(scorecard, results), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({ scorecard, results }, null, 2), 'utf8');
  return { mdPath, jsonPath };
}
