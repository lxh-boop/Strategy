# REA（Reverse Engineer Anything）使用说明

> 来源：[morluto/rea](https://github.com/morluto/rea)（MIT，~176k stars）
> 安装位置：技能在 `C:\Users\PC\.zcode\skills\reverse-engineer-anything\`（用户级）；CLI 无本地安装，经 `npx -y rea-agents@latest` 调用（当前 6.4.0）
> 安装方式：克隆仓库复制 skill 目录即可；CLI 首次 npx 自动下载后走缓存
> 前置：Node ≥22.19（本机 24.19）、Chrome；**无需安装 MCP 服务器**

## 这套工具是什么

对**网站**和**本地 JS/ASAR 包**做被动观察与静态取证的命令集：通过 CDP 附加到 Chrome 看页面脚本/DOM/网络/无障碍树，对 JS 做带 SHA-256 溯源的 AST 分析。两条铁律：**只观察不操作**（不注入、不点击、不绕过访问控制），**输出带 Evidence ID**（每次捕获可追溯、自带完整性声明）。果仁网登录态逆向全程用它完成。

## 两种使用方式

| 方式 | 说明 |
|---|---|
| Skill 自动触发 | 对话中出现"逆向/分析这个网站/看看它的实现"时，`reverse-engineer-anything` 技能自动挂载方法论 |
| CLI 手动执行 | 本文档的 `npx -y rea-agents@latest <命令>`，逆向操作的实际执行者 |

## 第 0 步：一次性准备（每个目标站点一次）

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 \
  --user-data-dir=<独立profile目录> --no-first-run "https://目标站点/"
```

1. **独立 profile**（如 `D:\cht\guorn-analysis\chrome-guorn`）——与日常浏览器隔离，登录 cookie 持久化，关窗重开仍有效；
2. 在窗口里**登录目标站点**（用自己的账号，这是合规边界）；
3. 之后每次复用：同命令重启（登录态在 profile 里），或 `chrome.exe --user-data-dir=同目录 "新URL"` 在实例内开新标签。

端口约定 **9222**；下文 `<endpoint>` 即 `http://127.0.0.1:9222`，`<targetId>` 从 `list-browser-targets` 取。

## 主线工作流：登录态网站逆向（四步）

```
① 启动 CDP Chrome 并登录 → ② list-browser-targets → ③ inspect-web-page 捕获 → ④ export-web-scripts 导出
```

| 步骤 | 命令 | 产物 | 说明 |
|---|---|---|---|
| ① 列目标 | `list-browser-targets <endpoint>` | 每页面的 targetId/URL/标题 | 页面刷新后 targetId 会变，**每次捕获前重新取** |
| ② 捕获页面 | `inspect-web-page <endpoint> <targetId> --include-script-sources --observation-ms 3000 --format json > page.json` | 脚本源码+DOM+网络+控制台，内嵌 Evidence ID | DOM 是**脱敏节点树**（只有属性名没有值）；加 `--include-accessibility-text` 得到无障碍树（**面板文字数据从这里拿**，文本在 `accessibility.nodes[].name`） |
| ③ 截图 | `capture-web-screenshot <endpoint> <targetId> --format json` | base64 PNG（自转存） | 界面布局/下拉选项的像素证据 |
| ④ 导出脚本 | `export-web-scripts <page.json> <输出目录>` | `files/origins/<源哈希>/...` 按网站原路径还原 | 输入**只认 inspect-web-page / capture-browser-scenario 的捕获文件**；输出目录必须不存在 |

## 全部常用命令速查

### 观察类（对着 CDP 浏览器）

| 命令 | 用途 | 注意 |
|---|---|---|
| `list-browser-targets <endpoint>` | 列页面目标 | 会被 origin 过滤规则排除部分页面 |
| `inspect-web-page <endpoint> <targetId>` | 页面全量捕获 | 可选 `--include-script-sources` / `--include-accessibility-text` / `--include-console-text`；DOM 只有属性名 |
| `capture-web-screenshot <endpoint> <targetId>` | 视口截图 | 像素证据；下拉展开态要先在页面里点开 |
| `analyze-web-bundle <endpoint> <targetId>` | 页面包 AST 分析 | 只看捕获窗口内的活动；**页面静止时可能返 0**，改用 inspect-web-page |

### 分析类（对文件）

| 命令 | 用途 | 注意 |
|---|---|---|
| `analyze-javascript-application <目录>` | 本地 JS/ASAR 静态图 | 适合下载好的 bundle/ Electron 应用 |
| `export-web-scripts <捕获json> <输出目录>` | 还原脚本文件树 | 输出目录必须不存在；同文件重跑可能报错——脚本源码本身就在捕获 JSON 的 `scripts[].source` 里，可自行解析 |

### 场景类（要导航/网络事件时）

| 命令 | 用途 | 注意 |
|---|---|---|
| `capture-browser-scenario <scenario.json>` | 带 start_url 导航、等待、网络事件、截图/DOM 的场景捕获 | connect 模式字段：`{mode:"connect", cdp_endpoint, target_id}`；`events:["network"]` 记录请求元数据，`capture.network` 控制是否存字节；**只能导航/等待，不能点击** |

## 典型场景

### A. 登录态网站逆向（标准流程，果仁实战）

```
① 启动 CDP Chrome 并登录
② inspect-web-page --include-script-sources > page.json（全部脚本进手）
③ export-web-scripts page.json logged-in/（按原路径落盘）
④ grep/静态分析：枚举、接口路径、加密函数
⑤ 面板数据用 --include-accessibility-text（拍平 nodes[].name 后 grep）
```

### B. 界面取证（拿下拉选项/表格数值）

无障碍树拍平文本是首选（数据全、可 grep）；下拉的**选项值**DOM 里没有（脱敏），用截图人工核对，或从导出 JS 里找 `<option` 构造模板。

### C. 网络行为观察

`capture-browser-scenario` + `events:["network"]` + `network:{request_body:true}`：抓请求序列与参数（响应体建议关，体积大）。想看**解密后的业务数据**：抓到密文后用已知解密函数本地还原（如果仁 AES）。

### D. 本地 JS 包分析

拿到 bundle 目录后 `analyze-javascript-application <目录>`——模块图、字符串、端点一览；压缩 JS 的实用阅读模式见 §5.2 的 grep/node 配方。

### E. 成果复用

CDP profile 里登录态还在时，重跑 §第 0 步 命令即可续捕；历史成果与场景文件集中在 `D:\cht\guorn-analysis\`。

## 本项目使用注意

1. **端口约定**：CDP 用 9222；与后端 3000、前端 5173 互不相干。出现 500 先排查后端（watch 模式 dist 失步/孤儿 node 进程），与 REA 无关——清理方式见 §6；
2. **产物落位**：逆向素材统一放 `D:\cht\guorn-analysis\`（不入 work 仓库）；文档类（逆向报告/方案）放 `work/docs/`——遵守用户规则：**本地可写，不提交不上传**；
3. **多行文本替换写脚本文件**：对仓库文件做批量修改时，`node -e "..."` 的转义会坏（\n、模板串），一律写成 `.js` 文件执行；仓库文件是 CRLF，匹配用 `/\r?\n/` 或按行 split；
4. **杀进程要精确**：`taskkill /IM node.exe` 会误伤前后端；用 PowerShell 按 CommandLine 特征（如 `*chrome-guorn*`、`*factor-agent-server*`）过滤后按 PID 杀；
5. **Evidence 引用**：对外结论引用 Evidence ID（如 `ev_b79807fb…`），捕获 JSON 与截图一并存档，别只留口头结论；
6. **npx 版本**：`@latest` 每次可能拉新版本，行为有差异时用 `npx rea-agents@6.4.0` 锁版本对比。

## 维护

- CLI 升级：`npx -y rea-agents@latest` 天然跟随最新；锁版本见上；
- Skill 升级：重新克隆 morluto/rea，覆盖 `C:\Users\PC\.zcode\skills\reverse-engineer-anything\`（内容刷新式同步）；改行为直接编辑其中文件；
- Chrome profile 过期（站点登录态失效）：删除 `chrome-guorn` 目录重建，重新登录一次即可；
- 成果归档：`guorn-analysis/` 内按任务建子目录，Evidence JSON 与截图随结论一起存。
