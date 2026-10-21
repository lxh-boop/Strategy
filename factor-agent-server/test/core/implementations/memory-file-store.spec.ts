import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MemoryEntry,
  renderMemoryLine,
  sanitizeSlug,
  selectWithinBudget,
} from '../../../src/core/memory-store.service';
import { MemoryFileStoreService } from '../../../src/core/implementations/memory-file-store.service';

/* ==========================================================
   长期记忆文件存储单元测试（ADR-0007 第 0 刀）：
   slug 清洗 / 注入预算 / 文件 CRUD / 损坏容错 / 摘要缓存生命周期
   ========================================================== */

describe('sanitizeSlug（slug 清洗）', () => {
  it('非法字符转连字符并折叠', () => {
    expect(sanitizeSlug('偏好 动量!!因子')).toBe('memo'); // 全部非法 → 兜底
    expect(sanitizeSlug('prefer-momentum  v2')).toBe('prefer-momentum-v2');
    expect(sanitizeSlug('  --Momentum__Factor--  ')).toBe('momentum-factor');
  });
  it('截断 64 且不去尾词', () => {
    const long = 'a'.repeat(70);
    expect(sanitizeSlug(long)).toHaveLength(64);
  });
  it('清洗后为空 → memo 兜底', () => {
    expect(sanitizeSlug('中文')).toBe('memo');
    expect(sanitizeSlug('')).toBe('memo');
  });
});

describe('selectWithinBudget（注入预算）', () => {
  const entry = (slug: string, updated: string, titleLen = 4, contentLen = 10): MemoryEntry => ({
    slug,
    title: '标'.repeat(titleLen),
    content: '容'.repeat(contentLen),
    created: '2026-10-20',
    updated,
  });

  it('按 updated 降序（新者先留）', () => {
    const picked = selectWithinBudget([entry('old', '2026-10-01'), entry('new', '2026-10-02')], 10, 10_000);
    expect(picked.map((e) => e.slug)).toEqual(['new', 'old']);
  });
  it('条数预算截断', () => {
    const picked = selectWithinBudget([entry('a', '2026-10-03'), entry('b', '2026-10-02'), entry('c', '2026-10-01')], 2, 10_000);
    expect(picked.map((e) => e.slug)).toEqual(['a', 'b']);
  });
  it('字数预算截断（按渲染行长度计）', () => {
    const a = entry('a', '2026-10-03');
    const lineLen = renderMemoryLine(a).length;
    const b = entry('b', '2026-10-02', 4, lineLen); // 第二条渲染必超预算
    const picked = selectWithinBudget([a, b], 10, lineLen + 5);
    expect(picked.map((e) => e.slug)).toEqual(['a']);
  });
  it('首条必收（超预算保底一条）', () => {
    const big = entry('big', '2026-10-03', 50, 500);
    const picked = selectWithinBudget([big], 10, 5);
    expect(picked).toHaveLength(1);
  });
  it('空记忆 → 空数组', () => {
    expect(selectWithinBudget([], 30, 800)).toEqual([]);
  });
});

describe('MemoryFileStoreService（文件实现）', () => {
  let rootDir: string;
  let store: MemoryFileStoreService;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-store-'));
    store = new MemoryFileStoreService(rootDir);
  });
  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('无记忆用户 → 空数组', async () => {
    await expect(store.listEntries(1)).resolves.toEqual([]);
  });

  it('新增 → 回读一致；再存同 slug 覆盖并沿用 created', async () => {
    const saved = await store.saveEntry(1, { slug: 'prefer-momentum', title: '偏好动量', content: '对动量类因子兴趣高。' });
    expect(saved.created).toBe(saved.updated);
    const list = await store.listEntries(1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug: 'prefer-momentum', title: '偏好动量', content: '对动量类因子兴趣高。' });

    const again = await store.saveEntry(1, { slug: 'prefer-momentum', title: '偏好动量（改）', content: '只做 20 日动量。' });
    expect(again.created).toBe(saved.created);
    const after = await store.listEntries(1);
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe('偏好动量（改）');
  });

  it('中文 slug 清洗落盘（可回读）', async () => {
    const saved = await store.saveEntry(1, { slug: '风险偏好', title: '风险偏好', content: '稳健型。' });
    expect(saved.slug).toBe('memo');
    const list = await store.listEntries(1);
    expect(list[0].slug).toBe('memo');
  });

  it('删除：存在 true / 不存在 false', async () => {
    await store.saveEntry(1, { slug: 'tmp-one', title: 't', content: 'c' });
    await expect(store.deleteEntry(1, 'tmp-one')).resolves.toBe(true);
    await expect(store.deleteEntry(1, 'tmp-one')).resolves.toBe(false);
    await expect(store.listEntries(1)).resolves.toEqual([]);
  });

  it('损坏文件（无 frontmatter / 缺字段）跳过不炸', async () => {
    await store.saveEntry(1, { slug: 'good-one', title: '好条目', content: '内容。' });
    const dir = path.join(rootDir, '1');
    fs.writeFileSync(path.join(dir, 'bad-nofm.md'), '没有 frontmatter 的纯文本', 'utf8');
    fs.writeFileSync(path.join(dir, 'bad-nofield.md'), '---\ntitle: 缺日期\n---\n\n正文', 'utf8');
    fs.writeFileSync(path.join(dir, 'bad-empty.md'), '---\ntitle: 空\ncreated: 2026-10-21\nupdated: 2026-10-21\n---\n\n', 'utf8');
    const list = await store.listEntries(1);
    expect(list.map((e) => e.slug)).toEqual(['good-one']);
  });

  it('人手微调（引号/空白）可解析', async () => {
    const dir = path.join(rootDir, '1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'hand-edit.md'),
      '---\ntitle: "手改条目"  \ncreated: 2026-10-20\nupdated: 2026-10-21\n---\n\n手改正文。',
      'utf8',
    );
    const list = await store.listEntries(1);
    expect(list[0]).toMatchObject({ slug: 'hand-edit', title: '手改条目', content: '手改正文。' });
  });

  it('摘要缓存：写 → 读 → 清；未写/已清/坏文件 → null', async () => {
    await expect(store.readSummary(1, 'conv-a')).resolves.toBeNull();
    await store.writeSummary(1, 'conv-a', '用户在调优动量策略。', 1234);
    const summary = await store.readSummary(1, 'conv-a');
    expect(summary).toMatchObject({ coveredChars: 1234, summary: '用户在调优动量策略。' });
    await store.clearSummary(1, 'conv-a');
    await expect(store.readSummary(1, 'conv-a')).resolves.toBeNull();
  });

  it('摘要缓存按会话隔离', async () => {
    await store.writeSummary(1, 'conv-a', 'A 会话摘要', 10);
    await store.writeSummary(1, 'conv-b', 'B 会话摘要', 20);
    expect((await store.readSummary(1, 'conv-a'))?.summary).toBe('A 会话摘要');
    expect((await store.readSummary(1, 'conv-b'))?.summary).toBe('B 会话摘要');
  });

  it('坏摘要文件（coveredChars 非数字）→ null', async () => {
    const threads = path.join(rootDir, '1', '_threads');
    fs.mkdirSync(threads, { recursive: true });
    fs.writeFileSync(path.join(threads, 'conv-x.md'), '---\ncoveredChars: NaN\nupdated: 2026-10-21\n---\n\n正文', 'utf8');
    await expect(store.readSummary(1, 'conv-x')).resolves.toBeNull();
  });
});
