/* ==========================================================
   参数期望的子集匹配器：expected ⊆ actual（递归）。

   - 对象：expected 的每个键都必须在 actual 中出现且递归匹配（actual 多出的键不算失败）；
   - 数组：expected 的每一项都能在 actual 中找到至少一项与之子集匹配（不比顺序与长度——
     只断言"期望的关键项在场"，实际多传什么不追究）；
   - 标量：宽松相等（数字/字符串混写按 String 对比，20230101 与 '20230101' 等价——
     模型按 schema 传字符串、人写期望时可能写数字）；
   - 标记：{$type: 'string'|'number'|'boolean'|'object'|'array'} 只断言类型；
     {$contains: '子串'} 只断言字符串包含。
   ========================================================== */

export type TypeMarker = { $type: 'string' | 'number' | 'boolean' | 'object' | 'array' };
export type ContainsMarker = { $contains: string };
export type OneOfMarker = { $oneOf: unknown[] };

function isMarker(v: unknown): v is TypeMarker | ContainsMarker | OneOfMarker {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && ('$type' in v || '$contains' in v || '$oneOf' in v);
}

export function subsetMatch(actual: unknown, expected: unknown): boolean {
  if (isMarker(expected)) {
    if ('$type' in expected) {
      if (expected.$type === 'array') return Array.isArray(actual);
      if (expected.$type === 'object') return typeof actual === 'object' && actual !== null && !Array.isArray(actual);
      return typeof actual === expected.$type;
    }
    if ('$oneOf' in expected) {
      return expected.$oneOf.some((opt) => subsetMatch(actual, opt));
    }
    return typeof actual === 'string' && actual.includes(expected.$contains);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((e) => actual.some((a) => subsetMatch(a, e)));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const rec = actual as Record<string, unknown>;
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) => {
      // 期望 undefined = "该键未传"：键缺席或显式 undefined 都算过
      if (v === undefined) return rec[k] === undefined;
      return k in rec ? subsetMatch(rec[k], v) : false;
    });
  }
  if (expected === undefined) return actual === undefined;
  // 标量宽松相等：数字/字符串形态差异不判负
  // eslint-disable-next-line eqeqeq
  if (typeof actual === 'object' || actual === null) return false;
  return String(actual) === String(expected);
}

/** 找出 actual 列表里第一个与 expected 子集匹配的元素（诊断报告用：给出失败详情） */
export function firstMatch<T>(items: T[], pick: (t: T) => unknown, expected: unknown): T | undefined {
  return items.find((t) => subsetMatch(pick(t), expected));
}
