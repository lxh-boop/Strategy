import type { EvalTask } from '../src/types';
import { CALIBRATION_TASKS } from './offline/calibration';
import { FABRICATION_TASKS } from './offline/fabrication';
import { CLARIFICATION_TASKS } from './offline/clarification';
import { CONFIRM_ROUTING_TASKS } from './offline/confirm-routing';

export type Suite = 'offline' | 'online' | 'all';

/** 在线端到端（真库真引擎）：一期未实施，见 tasks/online/README.md */
const ONLINE_TASKS: EvalTask[] = [];

const ALL: EvalTask[] = [...CALIBRATION_TASKS, ...FABRICATION_TASKS, ...CLARIFICATION_TASKS, ...CONFIRM_ROUTING_TASKS, ...ONLINE_TASKS];

/** id 去重防呆：编号撞车在报告里几乎不可诊断，直接在启动时炸掉 */
const dup = ALL.map((t) => t.id).filter((id, i, arr) => arr.indexOf(id) !== i);
if (dup.length) throw new Error(`任务 id 重复: ${[...new Set(dup)].join(', ')}`);

export function selectTasks(suite: Suite = 'offline', filter?: string): EvalTask[] {
  let pool = ALL;
  if (suite === 'offline') pool = pool.filter((t) => t.category !== 'e2e');
  if (suite === 'online') pool = pool.filter((t) => t.category === 'e2e');
  if (filter) {
    const pats = filter.split(',').map((s) => s.trim()).filter(Boolean);
    pool = pool.filter((t) => pats.some((p) => t.id === p || t.id.startsWith(p)));
  }
  return pool;
}
