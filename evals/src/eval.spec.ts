import * as path from 'node:path';
import { aggregate } from './metrics';
import { renderScorecardMd, writeReport } from './report';
import { runBatch } from './runner';
import { selectTasks, type Suite } from '../tasks';

/* ==========================================================
   跑批入口：jest 仅作 TS 执行器——本用例永远绿（测评是测量不是门禁），
   结果看 reports/ 下的指标卡。参数走环境变量：

   EVAL_SUITE  offline | online | all（缺省 offline）
   EVAL_K      每任务重复次数（缺省 4，pass^k 口径）
   EVAL_TASKS  逗号分隔的 id 前缀过滤（如 "cal-01,rt-"）
   EVAL_LABEL  指标卡标签（缺省 baseline）
   ========================================================== */

it('智能体测评跑批', async () => {
  const suite = ((process.env.EVAL_SUITE ?? 'offline') as Suite) ?? 'offline';
  const k = Number(process.env.EVAL_K ?? 4);
  const filter = process.env.EVAL_TASKS || undefined;
  const label = process.env.EVAL_LABEL ?? 'baseline';

  const tasks = selectTasks(suite, filter);
  if (!tasks.length) throw new Error(`套件 ${suite}（filter=${filter ?? '-'}）没有匹配任务`);
  console.log(`[evals] suite=${suite} k=${k} 任务数=${tasks.length}${filter ? ` filter=${filter}` : ''}`);

  const results = await runBatch(tasks, k, (msg) => console.log(`[evals] ${msg}`));
  const scorecard = aggregate(label, results, k);
  const reportsDir = path.resolve(__dirname, '..', 'reports');
  const { mdPath, jsonPath } = writeReport(reportsDir, label, scorecard, results);
  console.log(`[evals] 指标卡已写入:\n  ${mdPath}\n  ${jsonPath}\n`);
  console.log(renderScorecardMd(scorecard, results));
});
