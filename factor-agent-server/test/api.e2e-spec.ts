/* ==========================================================
   契约 e2e 测试样例（多人协作共享，随代码进 git）

   覆盖 docs/backend-api.md 契约的关键行为：
   - 会话四意图路由与卡片结构（chat 无卡片 / report / backtest / stocks）
   - 策略 CRUD、权重归一化（合计 ≠100 折算、全 0 报 400）、保存即回测、回测确定性
   - 个人中心 profile（模型/数据来源为 readonly 展示项）与设置项三种传参
   - 因子库 / 回测参数下发、选股筛选、统一错误格式 { error: { code, message } }

   确定性保证：置空 ZHIPU_API_KEY → 智能体走"关键词规则 + 模板文案"开发模式
   （langgraph-agent.service.ts 的 legacyReply），测试不调用真实 GLM、
   不消耗团队套餐额度、不依赖网络，任何机器拉代码即可跑。
   运行：npm run test:e2e
   ========================================================== */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { ApiErrorFilter } from './../src/common/api-error.filter';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/* 因子权重归一化断言：合计 100、保留 1 位小数 */
function expectNormalized(factors: { name: string; weight: number }[]) {
  expect(+sum(factors.map((f) => f.weight)).toFixed(1)).toBe(100);
  for (const f of factors) expect(+f.weight.toFixed(1)).toBe(f.weight);
}

describe('因子智投后端 · 契约 e2e 测试样例', () => {
  let app: INestApplication;

  beforeAll(async () => {
    /* 置空 LLM Key：走规则兜底 + 模板文案（确定性，见文件头说明） */
    process.env.ZHIPU_API_KEY = '';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    /* 与 main.ts 生产配置保持一致：全局校验管道 + 统一错误过滤器 */
    app.useGlobalFilters(new ApiErrorFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /* ---------- 健康检查 ---------- */

  it('GET /api/health 返回服务状态', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('factor-agent-server');
    /* 测试环境 LLM 已置空，应处于未配置（模板文案）模式 */
    expect(res.body.zhipuConfigured).toBe(false);
  });

  /* ---------- 会话模块（契约 §3.1）：四意图路由 ---------- */

  let convId: string;

  it('新建会话：自带欢迎语、标题为"新对话"', async () => {
    const res = await request(app.getHttpServer()).post('/api/conversations').expect(201);
    convId = res.body.id;
    expect(convId).toBeTruthy();
    expect(res.body.title).toBe('新对话');
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].role).toBe('agent');
    expect(res.body.messages[0].bubble).toContain('多因子选股智能体');
  });

  it('chat 意图（你好）：纯文本回复，不生成卡片', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .send({ text: '你好' })
      .expect(201);
    expect(res.body.userMessage.role).toBe('user');
    expect(res.body.agentMessage.bubble.length).toBeGreaterThan(0);
    expect(res.body.agentMessage.card).toBeUndefined();
  });

  it('report 意图（构建策略）：report 卡结构完整、因子权重合计 100；会话标题只在首条消息命名', async () => {
    const text = '帮我构建一个小盘动量策略';
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .send({ text })
      .expect(201);
    const card = res.body.agentMessage.card;
    expect(card.type).toBe('report');
    expect(card.title).toContain('小盘动量增强');
    expect(card.tag).toBe('进攻型');
    expectNormalized(card.factors);
    expect(card.universe).toBe('中证1000');
    expect(card.rawMetrics).toBeTruthy();
    expect(card.curve).toHaveLength(30);
    expect(card.curve[0]).toBe(100);
    expect(card.benchCurve).toHaveLength(30);
    /* 标题 = 首条用户消息（此前发的是"你好"），后续消息不再改名 */
    const list = await request(app.getHttpServer()).get('/api/conversations').expect(200);
    const conv = list.body.find((c: { id: string }) => c.id === convId);
    expect(conv.title).toBe('你好');

    /* 同会话追问"回测"：复用上一轮策略配置 → backtest 卡 */
    const res2 = await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .send({ text: '回测一下它的历史表现' })
      .expect(201);
    expect(res2.body.agentMessage.card.type).toBe('backtest');
    expect(res2.body.agentMessage.card.title).toContain('小盘动量增强');
  });

  it('stocks 意图（筛选）：stocks 卡、数量受 topN 限制、得分降序', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .send({ text: '在沪深300里筛选 ROE 大于15的股票' })
      .expect(201);
    const card = res.body.agentMessage.card;
    expect(card.type).toBe('stocks');
    expect(card.title).toContain('筛选结果');
    expect(card.tag).toMatch(/共 \d+ 只 · 展示前 \d+/);
    expect(card.stocks.length).toBeGreaterThan(0);
    expect(card.stocks.length).toBeLessThanOrEqual(5);
    const scores = card.stocks.map((s: { score: number }) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    for (const s of card.stocks) {
      expect(s.code).toMatch(/^\d{6}$/);
      expect(s.name).toBeTruthy();
    }
  });

  it('清空会话：重置为欢迎语、标题还原', async () => {
    const res = await request(app.getHttpServer()).post(`/api/conversations/${convId}/clear`).expect(201);
    expect(res.body.title).toBe('新对话');
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].role).toBe('agent');
  });

  it('删除会话：204，再访问历史消息返回 404 契约错误格式', async () => {
    await request(app.getHttpServer()).delete(`/api/conversations/${convId}`).expect(204);
    const res = await request(app.getHttpServer()).get(`/api/conversations/${convId}/messages`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBeTruthy();
  });

  /* ---------- 策略模块（契约 §3.2） ---------- */

  let strategyId: string;

  it('策略列表：4 个种子策略', async () => {
    const res = await request(app.getHttpServer()).get('/api/strategies').expect(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(['s1', 's2', 's3', 's4']));
  });

  it('新建策略：草稿态、权重合计 ≠100 按比例归一化', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/strategies')
      .send({
        name: 'e2e 测试策略',
        universe: '沪深300',
        rebalance: '每月调仓',
        factors: [
          { name: '价值', weight: 50 },
          { name: '成长', weight: 40 },
          { name: '动量', weight: 30 },
        ],
      })
      .expect(201);
    strategyId = res.body.id;
    /* 50/40/30 合计 120 → 41.7/33.3/25.0 */
    expect(res.body.status).toBe('draft');
    expect(res.body.benchmark).toBe('沪深300指数');
    expect(res.body.metrics).toBeNull();
    expectNormalized(res.body.factors);
  });

  it('保存权重 = 自动重新回测：draft → done，曲线/指标/持仓齐备', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/strategies/${strategyId}`)
      .send({
        factors: [
          { name: '价值', weight: 40 },
          { name: '成长', weight: 40 },
          { name: '动量', weight: 40 },
        ],
      })
      .expect(200);
    /* 40/40/40 → 33.4/33.3/33.3（残差补给最大项） */
    expect(res.body.status).toBe('done');
    expectNormalized(res.body.factors);
    expect(res.body.metrics).not.toBeNull();
    expect(typeof res.body.metrics.annual).toBe('number');
    expect(res.body.metrics.winRate).toBeGreaterThan(0);
    expect(res.body.metrics.winRate).toBeLessThanOrEqual(100);
    expect(res.body.curve[0]).toBe(100);
    expect(res.body.curve).toHaveLength(30);
    expect(res.body.holdings.length).toBeGreaterThan(0);
  });

  it('重新回测是确定性的：同一配置多次回测结果完全一致', async () => {
    const r1 = await request(app.getHttpServer()).post(`/api/strategies/${strategyId}/backtest`).send({}).expect(201);
    const r2 = await request(app.getHttpServer()).post(`/api/strategies/${strategyId}/backtest`).send({}).expect(201);
    expect(r1.body.curve).toEqual(r2.body.curve);
    expect(r1.body.metrics).toEqual(r2.body.metrics);
  });

  it('因子权重全 0：返回 400 INVALID_ARGUMENT', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/strategies/${strategyId}`)
      .send({ factors: [{ name: '价值', weight: 0 }, { name: '成长', weight: 0 }] })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    expect(res.body.error.message).toContain('0');
  });

  it('删除策略：204，报告随之 404', async () => {
    await request(app.getHttpServer()).delete(`/api/strategies/${strategyId}`).expect(204);
    const res = await request(app.getHttpServer()).get(`/api/strategies/${strategyId}/report`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  /* ---------- 选股筛选（契约 §3.4） ---------- */

  it('POST /api/screen：结果排序降序、total ≥ 返回数', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/screen')
      .send({ universe: '沪深300', filters: [{ field: 'roe_ttm', op: '>', value: 15 }], topN: 5 })
      .expect(201);
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.stocks.length);
    const scores = res.body.stocks.map((s: { score: number }) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('POST /api/screen 非法参数：400 契约错误格式', async () => {
    const res = await request(app.getHttpServer()).post('/api/screen').send({ filters: [] }).expect(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });

  /* ---------- 因子库 / 回测参数下发（契约 §3.5） ---------- */

  it('GET /api/factors 与 /api/backtest-params：配置型数据由后端下发', async () => {
    const factors = await request(app.getHttpServer()).get('/api/factors').expect(200);
    expect(factors.body.length).toBe(9);
    for (const f of factors.body) {
      expect(f.id).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.desc).toBeTruthy();
    }
    const params = await request(app.getHttpServer()).get('/api/backtest-params').expect(200);
    expect(params.body.length).toBe(3);
    for (const p of params.body) {
      expect(p.label).toBeTruthy();
      expect(p.value).toBeTruthy();
      expect(p.hint).toBeTruthy();
    }
  });

  /* ---------- 个人中心（契约 §3.6） ---------- */

  it('GET /api/user/profile：设置项 = notify/report(toggle) + risk(single)，无只读展示项', async () => {
    const res = await request(app.getHttpServer()).get('/api/user/profile').expect(200);
    const settings = res.body.settings;
    expect(settings.map((s: { key: string }) => s.key)).toEqual(['notify', 'report', 'risk']);

    const notify = settings.find((s: { key: string }) => s.key === 'notify');
    expect(notify.type).toBe('toggle');
    expect(notify.on).toBe(true);

    const risk = settings.find((s: { key: string }) => s.key === 'risk');
    expect(risk.type).toBe('single');
    expect(risk.choices).toEqual(['保守型', '稳健型', '平衡型', '积极型']);
    expect(risk.value).toBe('稳健型');
  });

  it('PATCH /api/user/settings：toggle 传 on、single 传 value', async () => {
    const t = await request(app.getHttpServer())
      .patch('/api/user/settings')
      .send({ key: 'notify', on: false })
      .expect(200);
    expect(t.body.settings.find((s: { key: string }) => s.key === 'notify').on).toBe(false);

    const s = await request(app.getHttpServer())
      .patch('/api/user/settings')
      .send({ key: 'risk', value: '积极型' })
      .expect(200);
    expect(s.body.settings.find((x: { key: string }) => x.key === 'risk').value).toBe('积极型');
  });

  it('PATCH /api/user/settings 白名单外 key：400（含已移除的 model/datasource）', async () => {
    for (const key of ['model', 'datasource', 'nope']) {
      const res = await request(app.getHttpServer())
        .patch('/api/user/settings')
        .send({ key, on: true })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    }
  });

  it('已下线的密钥管理接口保持 404（防止误恢复）', async () => {
    await request(app.getHttpServer()).post('/api/user/apikeys').send({ name: 'x', key: 'y' }).expect(404);
    await request(app.getHttpServer()).get('/api/user/apikeys').expect(404);
  });
});
