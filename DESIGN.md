---
name: 因子智投 AlphaSage
description: 对话式多因子选股智能体——策略商城浅色红的成熟投研工作台
colors:
  sm-red: "#d93a3f"
  sm-red-hover: "#e04a4f"
  sm-red-strong: "#bd2f34"
  sm-red-wash: "#fdeceb"
  sm-red-deep: "#c22f34"
  sm-red-light-end: "#e85457"
  ink: "#1f2329"
  ink-soft: "#5c6470"
  ink-faint: "#6b7280"
  paper: "#f4f5f7"
  card: "#ffffff"
  hairline: "#e8e9ec"
  hairline-strong: "#d7d9de"
  tile: "#f2f3f5"
  hover-wash: "#f6f7f9"
  rise-red: "#d93a3f"
  fall-green: "#1b7a45"
  danger-red: "#c62828"
  signal-amber: "#e6a700"
  amber-ink: "#b26a00"
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
    backgroundColor: "{colors.sm-red}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.sm-red-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px"
  input-text:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
---

# Design System: 因子智投 AlphaSage

## Overview

**Creative North Star: "策略商城浅色红"**（第四代，2026-10-22 换装定稿）

源世界：策略商城客户端（StrategyMarketClient，`--smk-*` 令牌体系）。全浅色投研商城：白色侧边栏与顶栏以发丝线切进浅灰画布，白色卡片以极轻柔影浮着；品牌红 `#d93a3f` 是唯一强调——主按钮实色无渐变无辉光、激活导航红水洗底、正收益数字与净值曲线同为品牌红。A 股语境里"红即涨即品牌"天然自洽（源软件生产验证过的取舍）。

成熟感来自三层：**纸面秩序**（白面板×浅灰画布的一刀分层）、**克制的印记**（红渐变只出现在铭牌位）、**工艺细节**（浅色滚动条/红水洗选中色/表头着色/设计过的空态）。

**Key Characteristics:**

- 全浅色：白侧边栏（右发丝线）+ 浅灰画布，`color-scheme: light`
- 品牌红渐变只出现在五个铭牌位（见 The Disciplined Flare Rule），主按钮实色
- 卡片极轻柔影：1px 发丝线 + 灰系小投影，hover 抬升
- 全部数值 tabular-nums 等宽、右对齐；红涨绿跌是唯一语义红绿
- 紧凑高密度：12–14px 字号，间距 6–18px，圆角 12/8/6

## Colors

### Primary
- **品牌红** (#d93a3f): 主行动色。主按钮（实色）、净值主曲线、红涨数字、聚焦环。Hover 亮一档 (#e04a4f)；文字级红用 strong (#bd2f34，白底 6.2:1)；水洗底 (#fdeceb) 用于激活项/卡头/空态。
- **品牌红渐变** (`120deg #e85457 → #d93a3f → #c22f34`): 全站唯一渐变，仅铭牌位（logo 方标/权重条/统计卡顶缘发丝/智能体头像方标）。

### Neutral（纸墨）
- **墨** (#1f2329) / **Soft** (#5c6470) / **Faint** (#6b7280)：文本三阶，Faint 白底 4.8:1。
- **画布** (#f4f5f7)；**面板** (#ffffff)；**发丝线** (#e8e9ec) / 强线 (#d7d9de)；**瓦片** (#f2f3f5)。

### Semantic（A 股口径）
- **涨红** (#d93a3f，与品牌红同源) / **跌绿** (#1b7a45，白底 5.6:1)：唯一语义红绿；成功水洗 #eaf5ee。
- **错误/回撤深红** (#c62828)：与品牌红区分，用于删除确认、回撤数字、错误态。
- **图形金** (#e6a700)：星标、IC 对比线等纯图形；浅底文字一律走琥珀墨 (#b26a00)。

### Named Rules
**The 红涨绿跌 Rule.** 涨红跌绿不得反接，不得引入西式配色。回撤/错误用深红 #c62828 与品牌红区分。

**The Disciplined Flare Rule.** 渐变只允许出现在铭牌位：① logo 方标 ② 因子权重条 ③ 统计卡顶缘发丝 ④ 智能体头像方标。导航激活态用红水洗底 + 红字（不用渐变）。主按钮实色无渐变无辉光。页面级大面积装饰渐变一律禁止。

**The Tabular Truth Rule.** 一切数值 tabular-nums、右对齐。

**The Flat Action Rule.** 按钮是实色的：主按钮红底白字，hover 亮一档，不发光不悬浮不上移。深度只属于卡片（发丝线 + 小柔影）。

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

232px 白色侧边栏 + 弹性浅灰主区。对话页 240px 会话列表 + 860px 对话列；策略页 4 列统计（顶缘渐变发丝）+ auto-fill 策略卡网格；个人中心 380px+1fr。页面 padding 24px 28px，卡片 18px。断点 1100/900/760 存量保留。

## Elevation & Depth

浅色纸面景深：卡片默认 `0 1px 2px rgba(16,24,40,.04)`；hover 抬升 `0 4px 14px rgba(16,24,40,.06)` + translateY(-2px)；弹窗/详情层 `0 12px 36px rgba(16,24,40,.14)`；遮罩 `rgba(16,24,40,.36) + blur(8px)`。深色内发光、黑系大投影已退役。

## Shapes

圆角 12/8/6/999 + 非对称聊天气泡（4/12）+ 16px 弹窗。边框统一 1px 发丝线；白面板内部分隔用 divider #eef0f3。

## Components

### Buttons
- **Primary:** 实色品牌红白字，hover 亮一档；每视图一个。
- **Ghost:** 强线边，hover 瓦片底。
- **Danger:** 透底深红字红边，hover 深红实底白字。

### Navigation（白色操作台）
- 灰字导航项，hover 瓦片底；**激活态红水洗底 + 红字**（#fdeceb / #bd2f34）；健康状态灯带语义光环。

### Cards
- 白底发丝线 12px 圆角 + 小柔影；统计卡带顶缘渐变发丝；数据瓦片 tile 底。

### Tables
- 表头着瓦片底、圆角内收；行 hover 提亮；数值列右对齐 tabular-nums。

### Chat
- 智能体头像红渐变方标 / 用户琥珀渐变圆标（#f3b71d→#d98f00）；用户气泡品牌红底白字；SSE 步骤药丸。

### Empty States（设计过的）
- 图标章（红水洗底 + 红图标）+ 标题 + 一句去向引导 + 主 CTA，虚线框容器。

## Do's and Don'ts

### Do:
- **Do** 渐变只落在铭牌位；强调用实色品牌红。
- **Do** 数值右对齐 tabular-nums；新控件 = 8px 圆角 + 发丝线 + 红聚焦环。
- **Do** 浏览器表面（滚动条/选中色/光标）跟随体系着色。
- **Do** 空态用 Empty State 组件，给用户下一步去向。

### Don't:
- **Don't** 页面级大面积装饰渐变、渐变文字。
- **Don't** 按钮加渐变、辉光、悬浮位移——深度是卡片的事。
- **Don't** 语义色挪作装饰；红绿只属于涨跌，深红 #c62828 只属于错误/回撤。
- **Don't** 图形金 #e6a700 直接当浅底文字色（用琥珀墨 #b26a00）。
