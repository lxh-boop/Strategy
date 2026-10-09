---
name: 因子智投 AlphaSage
description: 对话式多因子选股智能体——深色操作台 × 冷白工作区的成熟投研工作台
colors:
  alpha-indigo: "#4f5df0"
  alpha-indigo-deep: "#3d4bd8"
  alpha-indigo-wash: "#eef0fe"
  brand-flare: "#5b6cff"
  brand-flare-violet: "#8f5bff"
  lab-ink: "#182130"
  lab-ink-soft: "#4c5568"
  lab-ink-faint: "#646e80"
  lab-paper: "#f3f5f9"
  lab-card: "#ffffff"
  lab-hairline: "#e4e8f0"
  tile-wash: "#f7f8fb"
  tile-hairline: "#eceff5"
  terminal-navy: "#0f1524"
  terminal-navy-text: "#97a1b5"
  rise-red: "#d92f36"
  fall-green: "#087d52"
  signal-amber: "#f59e0b"
typography:
  headline:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  data:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.4
    fontFeature: "\"tnum\""
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  modal: "16px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "18px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.alpha-indigo}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.alpha-indigo-deep}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.lab-ink-soft}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  card:
    backgroundColor: "{colors.lab-card}"
    textColor: "{colors.lab-ink}"
    rounded: "{rounded.lg}"
    padding: "18px"
  input-text:
    backgroundColor: "{colors.lab-card}"
    textColor: "{colors.lab-ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
---

# Design System: 因子智投 AlphaSage

## Overview

**Creative North Star: "深色操作台 × 冷白工作区"**（因子实验室的成熟形态）

第三代视觉世界，也是定稿：实验室里那一台**深色操作台**（终端藏青侧边栏，带极缓的纵向明度渐变） anchoring 整个空间，冷白工作区里白色仪表面板以柔软的景深浮着。品牌焰蓝→焰紫渐变（#5b6cff→#8f5bff）作为**受控印记**回归——只出现在 logo、导航激活态、因子权重条、统计卡顶缘发丝和聊天头像这些"铭牌位"，主按钮用纯靛蓝加同色辉光，大面积装饰一律不用。

成熟感来自三层：**重量锚**（深浅一刀切开的铬材层级）、**景深**（卡片有柔和的双层环境光，hover 才抬升）、**工艺细节**（ themed 滚动条/选中色/光标、表头着色、设计过的空态）。

**Key Characteristics:**

- 深色操作台侧边栏 + 冷白工作区，深浅分离是全站的第一层级
- 品牌渐变只出现在五个铭牌位（见 The Disciplined Flare Rule），主按钮纯色 + 辉光
- 卡片柔和景深：1px 发丝线 + 双层环境光阴影，hover 抬升
- 全部数值 tabular-nums 等宽、右对齐；红涨绿跌是唯一语义红绿
- 紧凑高密度：12–14px 字号，间距 6–18px，圆角 12/8/6

## Colors

### Primary
- **Alpha靛蓝** (#4f5df0): 主行动色。主按钮（+同色辉光）、聚焦环、开关、链接。Deep (#3d4bd8) hover，Wash (#eef0fe) 选中底。
- **品牌焰蓝→焰紫渐变** (#5b6cff → #8f5bff): 受控品牌印记，五个铭牌位专用（见 Named Rules）。

### Secondary
- **Signal琥珀→红渐变** (#f59e0b → #ef4444): 仅用户角色头像（侧边栏/聊天/个人中心），与靛蓝形成"仪器 × 校准暖标"对照。

### Neutral（纸墨）
- **实验墨** (#182130) / **Soft** (#4c5568) / **Faint** (#646e80)：文本三阶，Faint 白底 5.1:1。
- **实验纸** (#f3f5f9) 工作区底；**实验卡纸** (#ffffff) 面板；**发丝线** (#e4e8f0)；**瓦片** (#f7f8fb / #eceff5)。

### Neutral（终端藏青，仅侧边栏）
- **终端藏青** (#0f1524→#141c33 极缓纵向渐变)：操作台。文本白 / **藏青灰** (#97a1b5)。

### Semantic
- **涨红** (#d92f36) / **跌绿** (#087d52)：唯一语义红绿。

### Named Rules
**The 红涨绿跌 Rule.** 涨红跌绿不得反接，不得引入西式配色。

**The Disciplined Flare Rule.** 渐变只允许出现在五个铭牌位：① logo 方标 ② 导航激活项 ③ 因子权重条 ④ 统计卡顶缘发丝 ⑤ 聊天/侧边栏头像。主按钮用纯靛蓝 + 辉光而非渐变。页面级大面积装饰渐变一律禁止。

**The Tabular Truth Rule.** 一切数值 tabular-nums、右对齐。

**The Anchored Depth Rule.** 深侧边栏是全站唯一的深色面；工作区内卡片用"发丝线 + 双层环境光"获得柔和景深，hover 才抬升，弹窗用重悬浮层。

## Typography

**Body Font:** "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif（系统 CJK 栈）
**Data:** tabular-nums；密钥 Consolas/Menlo

### Hierarchy
- **Headline** (700, 20px, -0.01em)：页面标题。
- **Title** (600, 15px)：卡片/区块标题。
- **Body** (400, 14px, 1.6)：正文、气泡、表格。
- **Label** (500, 12px)：指标标签、时间戳、徽章。
- **Data** (700, 14–24px, tabular-nums)：统计与指标值。

## Layout

232px 深色操作台 + 弹性冷白主区。对话页 240px 会话列表 + 860px 对话列；策略页 4 列统计（顶缘渐变发丝）+ auto-fill 策略卡网格；个人中心 380px+1fr。页面 padding 24px 28px，卡片 18px。断点 1100/900/760 存量保留。

## Elevation & Depth

三层景深：卡片默认 1px 发丝线 + 双层环境光（`0 1px 2px rgba(23,29,43,.04), 0 4px 16px rgba(23,29,43,.05)`）；策略卡 hover 抬升（`0 6px 24px .10` + translateY(-2px)）；弹窗/Toast 重悬浮层（`0 12px 40px rgba(16,22,35,.16)`）。主按钮与导航激活态带同色辉光（`0 4px 14px rgba(79,93,240,.30)` / `0 6px 18px rgba(91,108,255,.35)`）。

## Shapes

圆角 12/8/6/999 + 非对称聊天气泡（4/12）+ 16px 弹窗。边框统一 1px 发丝线；深色区内部分隔 `rgba(255,255,255,.08)`。

## Components

### Buttons
- **Primary:** 纯靛蓝底白字 + 同色辉光，hover 加深加亮；每视图一个。
- **Ghost:** 发丝线边，hover 瓦片底。

### Navigation（深色操作台）
- 藏青灰导航项，hover 白 6% 叠底；**激活态品牌渐变 + 辉光**；健康状态灯带语义光环。

### Cards
- 白底发丝线 12px 圆角 + 环境光；统计卡带顶缘渐变发丝；数据瓦片 tile 底。

### Tables
- 表头着瓦片底、圆角内收；行 hover 提亮；数值列右对齐 tabular-nums。

### Chat
- 智能体头像焰蓝渐变方标 / 用户琥珀渐变圆标；用户气泡靛蓝底白字；SSE 步骤药丸。

### Empty States（设计过的）
- 图标章（渐变浅底 + 靛蓝图标）+ 标题 + 一句去向引导 + 主 CTA，虚线框容器。

## Do's and Don'ts

### Do:
- **Do** 渐变只落在五个铭牌位；强调用纯靛蓝 + 辉光。
- **Do** 数值右对齐 tabular-nums；新控件 = 8px 圆角 + 发丝线 + 靛蓝聚焦环。
- **Do** 浏览器表面（滚动条/选中色/光标）跟随体系着色。
- **Do** 空态用 Empty State 组件，给用户下一步去向。

### Don't:
- **Don't** 页面级大面积装饰渐变、渐变文字。
- **Don't** 让工作区出现第二块深色面板（操作台只有一块）。
- **Don't** 语义色挪作装饰；红绿只属于涨跌与危险/成功。
