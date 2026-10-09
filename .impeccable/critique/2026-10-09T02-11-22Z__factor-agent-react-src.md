---
target: factor-agent-react 前端（因子智投）
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:D:\\cht\\work\\factor-agent-react\\src"
timestamp: 2026-10-09T02-11-22Z
slug: factor-agent-react-src
closed: true
---
# Impeccable Critique — factor-agent-react/src（因子智投前端）

Method: dual-agent (A: design review · B: detector + browser evidence)。B 的浏览器可视化经无头 Chrome CDP 回退完成（ZCode 浏览器运行时对子代理不可用），注入全部成功。

## Design Health Score（Nielsen 10 启发式，A 评审）

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | SSE 步骤药丸 + 打字点 + 健康灯好；但重新回测/保存权重零进度反馈，健康灯只在挂载时探测一次 |
| 2 | Match System / Real World | 3/4 | A股口径扎实；但图表 x 轴日期硬编码 ["2023-09","2024-06","2025-06","2026-09"]，与真实数据窗口无关——量化信任破坏点 |
| 3 | User Control and Freedom | 2/4 | 删除对话/清空对话无确认无撤销；流式回复不可取消；Esc + 遮罩点击可关弹窗 |
| 4 | Consistency and Standards | 2/4 | 对话页同屏 3 个靛蓝主按钮（体系规定最多一个）；plan-card 用了文档明令禁止的紫渐变；AuthView 是第二套样式方言 |
| 5 | Error Prevention | 2/4 | 权重合计守卫和已保存 ✓ 禁用态好；但流式进行中发送被静默丢弃且输入框已被清空 |
| 6 | Recognition Rather Than Recall | 3/4 | 建议 chip、悬停口径 tooltip、状态徽章；但 .conv-del 和参数口径只悬停可见 |
| 7 | Flexibility and Efficiency | 1/4 | 全站零键盘快捷键；组件态页面无深链（刷新永远回对话页）；保存成功 toast 无跳转 |
| 8 | Aesthetic and Minimalist | 3/4 | 实验室克制美学成立；死的"上传数据文件"按钮和空白雷达卡刺破它 |
| 9 | Error Recovery | 2/4 | 错误是 2.2s 瞬时 toast + 后端原文，无重试、无严重度样式、无 aria-live |
| 10 | Help and Documentation | 1/4 | 只有 AI 免责声明和注册 ASCII 提示；注册文案泄漏实现（"加密算法按字节处理"） |
| **Total** | | **22/40** | **Acceptable（显著改进空间）** |

## 审计健康分（技术审计，B 证据 + 汇总评分）

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 1/4 | 系统性低对比：#98a1b3 标签层在白底 2.6:1（会话 meta、时间戳、指标标签全中招）；核心导航 div onClick 键盘不可达；全站无 ARIA；悬停才出现的删除钮对焦点不可见 |
| 2 | Performance | 3/4 | 依赖极轻（纯 React+Vite），手写 SVG 图表，过渡走 transform/opacity，无布局抖动 |
| 3 | Theming | 2/4 | 令牌体系存在但大量散落硬编码（#f8f9fd/#f3f5fb/#edf0f6/#0a9e63 等）；AuthView 整套内联样式第二方言；plan-card 紫渐变离群 |
| 4 | Responsive Design | 3/4 | 声明范围（仅桌面）内良好：1100/900/760 断点存量健在 |
| 5 | Implementation Integrity | 2/4 | 核心链路产品特异（非模板货）；但存在死按钮、硬编码"陈研究员"人设、捏造轴日期、模板会员家具 |
| **Total** | | **11/20** | **Acceptable（需要大量修复）** |

## Design Specificity Verdict

**结论：为 A 股因子投研而作，不是可互换的通用模板。** 红涨绿跌语义、净值曲线 + 基准虚线、因子权重条、悬停回测口径、三态智能体健康灯（"GLM 已接入 · glm-5.3-flash"）、SSE 查数步骤药丸——全部直接服务 PRODUCT.md 的"数据可读性优先/状态诚实"。通用残留集中在边缘：硬编码"陈研究员"人设、捏造 x 轴日期、模板会员家具（专业版会员/续费升级卡）。

**确定性扫描**：静态 CLI 检测器 0 发现（exit 0；用含 Inter 字体的探针文件验证过检测器本身正常，确认是真干净）。渲染页注入检测（detect.js）三页各 14-17 反模式：对话页 14（low-contrast ×13、dark-glow ×1、tiny-text ×1）、策略页 15（+text-occlusion ×2）、个人中心 17（low-contrast ×14）。渲染层发现与 A 的计算对比度分析互相印证。
**误报甄别**：dark-glow（nav-item.active 的靛蓝光晕）是 DESIGN.md 明文许可的品牌激活态签名，误报；text-occlusion ×2 是检测器自己注入的标签被遮挡，误报。

## Priority Issues（合并清单）

1. **[P0] 静默丢消息 + 流式不可控** — hooks/useConversations.ts:110（inFlight 守卫静默 return）+ pages/ChatPage.tsx:213-218（send() 先清空输入，submit 丢弃时文字已蒸发）。分钟级回测期间用户打字点发送，文字无声消失；且无停止按钮。修：可见的"回复生成中"态（禁用/排队）、保留草稿、加停止控件。
2. **[P0] 核心导航键盘/读屏不可达 + 系统性低对比** — .conv-item（ChatPage.tsx:244）、.strategy-card（StrategiesPage.tsx:27）、.sidebar-user（App.tsx:158）、.setting-row（ProfilePage.tsx:178）全是 div onClick，会话切换键盘无法到达；.conv-del 悬停才可见（global.css:190-192），聚焦时是隐形控件；全站零 aria-label；弹窗无焦点陷阱/role="dialog"；#98a1b3 标签层 2.6:1、.agent-status-sub 加 opacity .55 后 ≈2.65:1（"请启动 factor-agent-server"是全站最重要却最难读的句子）。修：真按钮或 role+tabIndex、:focus-within 显形、体系靛蓝 focus-visible 环、标签层提到 4.5:1。
3. **[P1] 不诚实的空态/边态** — StrategiesPage.tsx:392 硬编码 `stat-value up`：零策略账号显示红色"0.0%"平均年化（真值为负时颜色也会错——违反它本要服务的红涨绿跌规则）；RadarChart（charts.tsx:111）对 radar: [] 渲染纯空白读作"坏了"；ChatPage.tsx:299 "上传数据文件"无任何处理器——承诺数据上传的死按钮。修："—"占位、按符号取色、雷达空态、删掉或接通死按钮。
4. **[P1] 破坏性操作不对称 + 慢操作无 busy 态** — 删除对话（ChatPage.tsx:251）/清空对话（:269）立即执行无确认，删除策略却用突兀的原生 window.confirm（StrategiesPage.tsx:357）；重新回测/保存并生成回测报告（:169-173）await 期间无禁用/忙碌态——双击重复提交 + 分钟级静默。修：设计过的确认弹窗统一破坏性操作；两个回测触发器加 busy/禁用 + 进度文案。
5. **[P1] 主题体系离群值收敛** — plan-card 紫渐变（global.css:495，DESIGN.md 点名的历史离群）、AuthView 第二方言（8px 圆角 vs 体系 10px、纯色 logo vs 渐变、label 无 htmlFor 配对）；散落硬编码色值应归位令牌。
6. **[P2] 量化可读性细节** — charts.tsx:39 硬编码轴日期可给任何回测窗口贴错时间戳；表格数字列左对齐（仅末列右对齐 global.css:276）、.sc-metric 值居中（:377）违反 DESIGN.md"数值右对齐"；净值图无 100 基准线。对扫读持仓权重/因子得分的用户，这是实验记录与宣传册的区别。
7. **[P2] 文案诚实度** — "回测报告已导出（演示）"（StrategiesPage.tsx:209）宣称了没发生的导出；注册页实现泄漏；聊天头像/个人卡硬编码"陈"字（ChatPage.tsx:138 / ProfilePage.tsx:143），多字节昵称渲染成乱码无兜底。

## Cognitive Load

8 项清单挂 2 项、半挂 2 项。最重：StrategyDetailModal 页脚把删除策略 + 重新回测 + 保存并生成回测报告（破坏/重算/提交三种决策）捆在一行，弹窗内还有 5 个滑杆 + 持仓表 + 参数；权重滑杆拖动时不联动归一，用户需心算凑 100。

## Persona Red Flags

- **Alex（急躁高手）**：零快捷键（无 ⌘K、无 / 聚焦输入、无 Esc 停止生成）；刷新永远回对话页，策略/会话无深链；"策略已保存"toast 无跳转；会话名 16 字截断无改名；聊天输入是单行 input，长 prompt 不能换行。
- **Sam（无障碍依赖）**：登录→发消息→存策略键盘几乎走通，但会话切换（div）断裂 + 登录后重挂载焦点丢失；#98a1b3 11px 标签 2.6:1 系统性 AA 失败；toast 无 aria-live；跌绿 #0a9e63 白底 3.45:1。
- **陈工（投研/量化爱好者）**：持仓表因子得分/权重列左对齐无法纵向扫读；.sc-metric 居中破坏跨卡对比；硬编码轴日期让净值时间窗不可信；无 100 基准线。加分项：精度正确（Sharpe 2 位小数）、涨跌带 +/− 号、因子权重在卡片标签和悬停参数瓦片两处可追溯。

## Minor Observations

- 导航徽章零策略时显示"0"（App.tsx:145）。
- mock 的 PROFILE 雷达/模型只读行（mock.ts:36）后端未供——个人中心相对 PRODUCT.md 少交付。
- 登录页本身干净聚焦；ASCII 密码约束披露诚实。
- 聊天页同屏三个靛蓝主按钮（新建对话/发送/查看我的策略）。

## Questions to Consider

1. 真实回测流式跑 90 秒时，药丸停了之后用户看到什么——"还在算"和"后端挂了"拿什么区分？
2. 一个把"状态诚实"写进第一原则的产品，该给零策略账号显示红色的平均年化"0.0%"吗？
3. "保存并生成回测报告"是一个按钮做两个决策——只想存权重不想重跑回测的用户怎么办？
4. 对话页三个主按钮哪个配得上靛蓝，另外两个降级成什么？
