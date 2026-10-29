import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryEntry, MemoryQueue, queueText, renderQueueLine } from '../../../src/core/memory-store.service';
import { MemoryFileStoreService } from '../../../src/core/implementations/memory-file-store.service';

/* ==========================================================
   长期记忆队列文件存储单元测试（ADR-0013）：
   追加不判重 / 队列读写 / 折叠写回 / 忘掉删除 / 旧条目迁移 / 摘要缓存生命周期
   ========================================================== */

const entry = (time: string, title: string, content = '内容。'): MemoryEntry => ({ time, title, content });

describe('记忆队列纯函数', () => {
  it('renderQueueLine：时间 + 标题 + 内容', () => {
    expect(renderQueueLine(entry('2026-10-29 09:00', '只用动量因子', '回调加仓。'))).toBe(
      '- [2026-10-29 09:00] 只用动量因子：回调加仓。',
    );
  });
  it('queueText：摘要段在前 + 条目行', () => {
    const q: MemoryQueue = { summary: '旧要点', foldedCount: 2, updated: '', entries: [entry('2026-10-29 09:00', 't')] };
    expect(queueText(q)).toBe('旧要点\n- [2026-10-29 09:00] t：内容。');
    expect(queueText({ summary: '', foldedCount: 0, updated: '', entries: [] })).toBe('');
  });
});

describe('MemoryFileStoreService（队列文件实现）', () => {
  let rootDir: string;
  let store: MemoryFileStoreService;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-queue-'));
    store = new MemoryFileStoreService(rootDir);
  });
  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('无记忆用户 → 空队列', async () => {
    const q = await store.readQueue(1);
    expect(q).toMatchObject({ summary: '', foldedCount: 0 });
    expect(q.entries).toEqual([]);
  });

  it('追加不判重：重复主题两次追加 = 两条并存', async () => {
    await store.appendEntry(1, { title: '只用动量因子', content: '回调加仓。' });
    await store.appendEntry(1, { title: '只用动量因子', content: '再次确认。' });
    const q = await store.readQueue(1);
    expect(q.entries).toHaveLength(2);
    expect(q.entries[0].content).toBe('回调加仓。');
    expect(q.entries[1].content).toBe('再次确认。');
  });

  it('写回：折叠摘要 + 剩余条目 + foldedCount 落盘可回读', async () => {
    await store.appendEntry(1, { title: '老偏好', content: '旧值。' });
    await store.appendEntry(1, { title: '新偏好', content: '新值。' });
    const queue = await store.readQueue(1);
    const next: MemoryQueue = {
      summary: '一、需求与结论：改用低波动。二、已确定的关键参数：无。三、未决事项：无。',
      foldedCount: 1,
      updated: queue.updated,
      entries: queue.entries.slice(1),
    };
    await store.writeQueue(1, next);
    const reread = await store.readQueue(1);
    expect(reread.summary).toContain('改用低波动');
    expect(reread.foldedCount).toBe(1);
    expect(reread.entries.map((e) => e.title)).toEqual(['新偏好']);
  });

  it('忘掉：读队列 → 过滤 → 写回，条目物理消失', async () => {
    await store.appendEntry(1, { title: '只用动量因子', content: 'a' });
    await store.appendEntry(1, { title: '万三手续费', content: 'b' });
    const queue = await store.readQueue(1);
    queue.entries = queue.entries.filter((e) => !e.title.includes('动量'));
    await store.writeQueue(1, queue);
    const reread = await store.readQueue(1);
    expect(reread.entries.map((e) => e.title)).toEqual(['万三手续费']);
  });

  it('迁移：旧 <slug>.md（ADR-0007 格式）导入队尾并清除', async () => {
    const dir = path.join(rootDir, '7');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'prefer-momentum.md'),
      '---\ntitle: 偏好动量\ncreated: 2026-10-20\nupdated: 2026-10-21\n---\n\n只做 20 日动量。',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'fee-habit.md'),
      '---\ntitle: 万三手续费\ncreated: 2026-10-20\nupdated: 2026-10-22\n---\n\n双边万三。',
      'utf8',
    );
    const q = await store.readQueue(7);
    expect(q.entries.map((e) => e.title)).toEqual(['偏好动量', '万三手续费']); // updated 升序
    expect(q.entries[0].time).toBe('2026-10-21');
    expect(fs.existsSync(path.join(dir, 'prefer-momentum.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'fee-habit.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'memory.md'))).toBe(true);
    // 幂等：再读不再迁移
    const again = await store.readQueue(7);
    expect(again.entries).toHaveLength(2);
  });

  it('迁移跳过坏文件（无 frontmatter / 缺字段）', async () => {
    const dir = path.join(rootDir, '8');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'good-one.md'), '---\ntitle: 好条目\ncreated: 2026-10-20\nupdated: 2026-10-21\n---\n\n内容。', 'utf8');
    fs.writeFileSync(path.join(dir, 'bad-nofm.md'), '没有 frontmatter 的纯文本', 'utf8');
    fs.writeFileSync(path.join(dir, 'bad-nofield.md'), '---\ntitle: 缺日期\n---\n\n正文', 'utf8');
    const q = await store.readQueue(8);
    expect(q.entries.map((e) => e.title)).toEqual(['好条目']);
  });

  it('人手微调（引号/空白）可解析', async () => {
    const dir = path.join(rootDir, '9');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'memory.md'),
      '---\nsummary: "手改摘要"  \nfoldedCount: 1\nupdated: 2026-10-29 09:00\n---\n\n## [2026-10-29 08:00] 手改条目\n手改正文。',
      'utf8',
    );
    const q = await store.readQueue(9);
    expect(q.summary).toBe('手改摘要');
    expect(q.foldedCount).toBe(1);
    expect(q.entries[0]).toMatchObject({ time: '2026-10-29 08:00', title: '手改条目', content: '手改正文。' });
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
