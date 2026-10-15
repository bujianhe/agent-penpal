---
name: agent-penpal
version: 0.2.0
description: 让两台机器上的 agent（Claude Code / Codex / OpenClaw）跨主机对话、互相问事——一边够不着的东西，它自己去问另一边。需要另一台机器的信息/硬件/环境（或用户点名"问 X"）时用；本机能答的别用。触发：/agent-penpal、"出名片/get my card"→ 出名片；贴对方名片或"连接/connect"→ 发消息、拉答复；收到【来自X】+名片→按约定回答。场景：服务器 agent 问 PC、连不了硬件要另一台代查、A↔B 联调、从零冷启动。关键词：跨机器、remote daemon、agent connector、relay、card、路由、setup.mjs、ask.mjs。
---

# Paseo 跨主机 Agent 对话

两台机器上的 agent（CC / Codex / OpenClaw 都行）互相提问、多轮对话。**人只发命令或名片；下面所有脚本都由 agent 自己执行，人不用敲命令。** 机器对称，不分服务器/客户端。

核心机制：`paseo <命令> --host <配对链接>` 走公共 relay（端到端加密）直连对方 daemon，相当于远程操作对方机器上的 Paseo（ls≈窗口列表、send≈发消息、logs≈看记录）。

> **安全：LINK = 对那台 daemon 的完整控制权，当密钥保管，别外传。**

## 装到一台新机器（agent 自己动手，三条）

> **第 1 条是人做的**（把 skill 放上去）。**第 2、3 条是你自己要做的**——缺什么装什么，**别让用户去装**。装完接着往下走，不要停下来问"要不要我装"。

1. **放 skill**：二选一——
   - **插件市场装**：`claude plugin marketplace add bujianhe/agent-penpal` → `claude plugin install agent-penpal@agent-penpal`
   - **手动拷目录**：整个 `agent-penpal/` 目录放进该 agent 的 skill 目录——Claude Code 是 `~/.claude/skills/agent-penpal/`（Windows：`%USERPROFILE%\.claude\skills\agent-penpal\`）。没 skill 机制的 agent（纯 AGENTS.md / 系统提示）：把本文贴进去一样生效。
2. **装 Node 18+**（先 `node -v`；低于 18 才需要装，20/22 LTS 都行）：
   - Windows：`winget install OpenJS.NodeJS.LTS`
   - macOS：`brew install node`
   - Linux：`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
3. **确认有 paseo CLI**——两种来源，**有其一即可，别重复装**：
   - **装了 Paseo 桌面 App 的**：它**自带一份 CLI**，不用再装。App 装好后 CLI 在这些位置（脚本会自动找到，不用手动配）：
     - macOS：`/Applications/Paseo.app/Contents/Resources/bin/paseo`
     - Linux：deb/rpm 在 `/opt/Paseo/resources/bin/paseo`；AppImage 用户通常已有 `~/.local/bin/paseo`
     - Windows：`%LOCALAPPDATA%\Programs\<安装目录>\resources\bin\paseo.cmd`（目录名不固定，脚本用扫的）
   - **没装 App 的**：`npm i -g @getpaseo/cli`，然后 `paseo --version` 验证。
4. **确认这台机器有一个 paseo 拉得起来的 agent CLI**（"对话窗口"要用它）。**先跑 `paseo provider ls` 看你机器上有哪些 provider、哪家 status 是 `available`**——只有 available 的才真能用。
   **一个容易踩的坑**：paseo 内置一份 30 多条目的 **ACP 目录**（`cursor` / `gemini` / `cline` / `qwen-code`…都在里面），那是"可以装、装了就能注册"的清单，**不等于你机器上已注册的 provider**。没装对应 CLI 时 `--provider gemini` 会直接报 `Unknown provider: gemini`。这版 paseo 里真正注册的是 `claude` / `codex` / `copilot` / `opencode` / `pi` / `omp` / `antigravity` / `muse`，而哪些能用取决于对应 CLI 装没装。
   **`cursor` 指的是 `cursor-agent` 这个命令行工具**（`cursor-agent acp`），**不是 Cursor IDE 里的会话**——paseo 是"自己拉起 agent 进程"的宿主，接不进 IDE 里已有的对话。

自查一行：`node -v && paseo --version`。（脚本自己会依次找 `$PASEO_CLI` → PATH → 桌面 App 自带那份，所以 `paseo` 不在 PATH 上也能跑。）
**`paseo --version` 报找不到、但确实装过** = npm 全局 bin 不在 PATH（macOS/Linux 的 GUI agent 常见）：`npm prefix -g` 拿到目录，Unix 再拼上 `/bin` 就是全局 bin 目录（Windows 的 prefix 本身就是 bin 目录），把它加进 PATH。注意 `npm bin -g` 在 npm 9+ 已被删除，别用。
**只装了桌面 App、想手动敲 `paseo` 命令**（脚本不需要）：照上面第 3 条的路径软链一份到 PATH 即可，例如 macOS `ln -sf "/Applications/Paseo.app/Contents/Resources/bin/paseo" ~/.local/bin/paseo`——这是 App 官方预期的用法。

## 触发与路由（先判断干什么）

**第一步：这个问题本机能答，还是得问远程？**（模型自己判断，不用等用户说"用 skill"）

| 情况 | 动作 |
|---|---|
| 本机能直接干（普通问答、本机文件/命令/代码） | **本机干，别进本 skill** |
| 需要**另一台机器**的信息/硬件/环境（PC 的 adb、服务器上的项目或构建环境、对方的 agent 状态……），或用户点名"问 X" | **远程** → 第二步找坐标，走 ② |
| 输入是 `/agent-penpal`（不带内容）、"获取名片"、"get my card" | **① 出名片**（默认调用=只读） |
| 用户明确说出**唯一口令** `/agent-penpal reset pair`（危险操作；其它任何说法一律不算，包括中文） | 先复述代价并**等用户确认**；确认后才 `setup.mjs --rotate --confirm`（见"链接泄漏了怎么办"） |
| 输入里直接带名片（±问题）；收到 `【来自X】`+名片的消息 | 名片场景，见下面第二步第 1 条和 ③ |

**第二步：远程坐标从哪来（按优先级，从上往下用）：**

| 优先级 | 来源 | 怎么做 |
|---|---|---|
| 1 | **对话上下文里的名片**——用户贴过的、`【来自X】`消息里带的（对方每条消息都自动附名片！）、之前发过的。模型自己看得见，**不用查任何地方** | 直接照抄 LINK/AGENT 给 ask.mjs，或名片整块贴进去 |
| 2 | **名册** `~/.paseo-peers.json`（多台；**按最近使用排序、带一句话介绍**，身份=pair+agentid，名字/描述最新覆盖） | 点名了 → `--peer <名字>`；**新会话/上下文空的 → `--list`** 拿最近用的（默认第一条就是最近） |
| 3 | **最近一次** `~/.paseo-peer*`（单坑兜底） | 泛说"问远程/发给对方/ask the remote"且上下文和名册都没有 → ask.mjs 没坐标时自动用它 |
| 4 | 都没有 / 多台分不清 | **只有一台 → 直接用它**；多台对不上号 → `--peer <名字>` 现在会**直接把候选列出来**（序号+窗口ID，退出码非 0、消息没发出去），把这份候选给用户挑，选定后 `--agent <窗口ID>` 重发——**别猜** |

口诀：**本机能干就不进 skill；要远程先翻上下文里的名片（最近聊过的直接照抄，最省事）；上下文没有翻名册（只有一台直接用）；再没有用"最近一次"；多台分不清把列表给用户挑。**

> 名册是"防遗忘"：会话被压缩、换新会话后上下文里的名片没了，名册顶上。收到名片时顺手 `--remember` 存一份（见 ③）。
> 不搞 `:get`/`:connect` 子命令：各 agent 语法不通用，名片内容本身就够区分。

## ① 出名片（让自己可被连）

agent 直接跑：

```bash
node <skill目录>/scripts/setup.mjs --name <本机名字，如 电脑>
```

一条龙：检查环境（缺 paseo CLI 直接给安装命令）→ 起本地 daemon（已在跑就跳过）→ 生成配对链接 → 定对话窗口（在 Paseo agent 窗口里跑就用**当前会话**；普通终端里跑：**先沿用 `~/.paseo-self-agent` 里已存的对话窗口**——还在就直接用，重复跑不乱开窗；没有才后台新开一个常驻 agent，默认 `--mode bypassPermissions` 授权，否则执行对方请求时第一个工具调用就卡权限审批）→ 坐标写进 `~/.paseo-self-*` → 打印名片。**把名片原样转给用户**，让用户发给对方。

**provider 怎么定**（新开窗口时）：`--provider` 显式给 > **当前会话用的那个**（脚本 inspect `$PASEO_AGENT_ID` 问 daemon，不猜——在 codex 窗口里跑就自动是 codex）> 都不行才 `claude`。dump 在 dry-run 计划里能看到"provider：X（来源：…）"。

**模型怎么定**（新开窗口时）：`--model` 显式给 > **按 provider 读本机配置** > 都不给才让 paseo 自己决定。目前认两个 provider：`claude` 读项目/用户的 `.claude/settings.json`（顶层 `model`，或 `env.ANTHROPIC_MODEL` 等，最后兜底环境变量），`codex` 读 `~/.codex/config.toml` 的顶层 `model`（注意 codex 的名字没有 Claude Code 那套 `[1M]` 后缀约定）。**其它 provider 不猜**——读不到就不传，宁可交给 paseo。**为什么不能全交给 paseo**：它建窗口时用的是**自己内置的 manifest**（按 `defaultPriority` + 本机 Claude Code 版本挑，如 `claude-opus-5-5`），**不读任何配置文件**——settings.json 里的模型只会被追加进"可选列表"，永远不带 `isDefault`。自建网关/非官方端点下那个原生名多半不存在，窗口就起不来（表现是对方"连不上"）。沿用已有窗口时**不动它的模型**，只把模型名显示出来方便核对；要换用 `switch-model.mjs`（见下）。

**权限模式也是按 provider 的**：`claude` 用 `bypassPermissions`，`codex` 用 `full-access`——模式名各家不一样，写死一个会让别的 provider 直接建不出窗口（`Invalid mode ... Available modes: ...`）。脚本查表给；表里没有的就先不传，失败时报错会列出可用模式，脚本挑一个最像"免审批"的自动重试一次。
> **一张就够**：对方拿到这张名片发第一条消息时，`ask.mjs` 会自动把它自己的名片附在消息开头——所以对面也拿到了你的坐标，双向就通了。**不需要两边各递一次。**

**名片的一句话介绍（可选，≤200 字）**：内容是**职责**（仓库级——这台机器/这个项目能帮对方处理哪方面问题、什么时候该找你；例：`--desc "有安卓源码和 adb：查安卓构建、抓日志、跑真机测试时找我"`）。不传的话，**首次** setup 会自动从当前目录的 README.md / CLAUDE.md / AGENTS.md 提取一句；都没有才退而用对话窗口标题；生成后固定不变（想刷新：删 `~/.paseo-self-desc` 再跑，或 `--desc` 手动覆盖）。想措辞更贴切，agent 可以先读 README/CLAUDE.md 自己总结一句再传 `--desc`。**拿不准就留空**——宁可没有这行，也别把文档里的示例、或自己猜的职责硬编进去（这行是发给别人看的"你能帮什么"，编错了比空着更糟）。**"当前在处理什么"这类会变的信息别写进静态简介**；需要时用单条覆盖：`ask.mjs --self-desc "当前在处理：XX"`。

**让 daemon 一直在线**（配对是一次性的；日常只要 daemon 在跑——CC/Codex 不用常开，来消息时 daemon 会自动把窗口的进程拉起来续聊，前提是对应 provider CLI 还装着）。daemon 就是 **paseo CLI 起的后台进程**（`paseo daemon start` 起的就是它，**不需要桌面 App**；桌面 App 只是可选的另一个宿主，App 开着时会自带一个同样的 daemon）。

**1）建议开启开机自启**。原因：对端找你时只认"你的 daemon 此刻在不在线"——不在线就直接连接失败、**消息不会排队**（没有离线补投）。不配自启 = 每次重启后都有一段"失联期"，而对方并不知道你什么时候在线，那段时间找你的人就丢了。

**要托管的就是这一条命令**（其余是各平台的常规做法，agent 自己会）：

```
__PASEO__ daemon run
```

`__PASEO__` = paseo CLI 的**绝对路径**（`which paseo`，或 `node setup.mjs` 的探测结果；装了桌面 App 的通常是 App 里那份）。**不能只写 `paseo`**——systemd / launchd / 计划任务**都不读 shell 的 rc 文件**，它们眼里 PATH 上没有 `paseo`。

⚠️ **三个坑**：

1. **是 `daemon run`，不是 `daemon start`。** `daemon start` 那套 `--foreground` **已被移除**，用了会直接报错 `--foreground was removed`。
2. **daemon 要能找到你的 provider CLI**（`claude` / `codex` / `cursor-agent`……来消息时要拉起它们续聊）。如果它们在 `~/.local/bin` 这类非标准位置，守护进程的最小 PATH 里没有——unit 里得显式 `Environment=PATH=<你的 PATH>`。
3. **Linux 无桌面环境**必须 `loginctl enable-linger "$USER"`，否则你一退出登录它就停。

**各平台怎么托管那条命令**：

- **Linux**：systemd 用户服务，`~/.config/systemd/user/paseo.service` 里 `ExecStart=__PASEO__ daemon run`、`Restart=always`，然后 `systemctl --user enable --now paseo`
- **macOS**：`~/Library/LaunchAgents/` 下放个 plist（`RunAtLoad` + `KeepAlive`）；**装了桌面 App 的话，加进「系统设置 → 通用 → 登录项」更省事**（App 起 = daemon 起）
- **Windows**：任务计划程序加一条"登录时"跑那条命令；或把桌面 App 丢进"启动"文件夹

> **agent 该主动配，别只把这段文档丢给用户。** 这是常规的系统设置，范围也清楚。配完告诉用户一声：配了什么、怎么撤（Linux `systemctl --user disable --now paseo`；macOS `launchctl unload …` 或从登录项移除；Windows 删掉那条计划任务）。

**配完自检（三平台通用）**：`paseo daemon status` 要显示 running，否则对方找不到你。

**2）没配自启的，每次开机后手动跑一次**（幂等，已在跑会跳过；装桌面 App 的直接打开 App 也行，App 起 = daemon 起）：

```bash
paseo daemon status   # 先看跑没跑
paseo daemon start    # 没跑就起它（或 paseo onboard，效果一样、还带配对指引）
```

链路断了先查这里：`paseo daemon status` 不是 running，对方就找不到你。

## ② 连接（拿到名片就能问）

名片的来源无所谓——用户刚贴的、还是**对话上下文里翻到的**（上次收到的 `【来自X】` 消息里带着），照抄 `LINK`/`AGENT` 两行（或整块贴），然后跑：

```bash
node <skill目录>/scripts/ask.mjs <LINK> <AGENT> "消息"
node <skill目录>/scripts/ask.mjs --peer <名字> "消息"    # 只记得名字、上下文没名片时（查名册）
```

- **带了问题** → 消息 = 问题原文。
- **只有名片没消息** → 脚本自动补握手语："连接成功，请回复确认。（Connected. Please confirm.）"（想带名字/换语言就自己传消息）
- 名片整块原样粘给 ask.mjs 也行（脚本自己会扒出 LINK/AGENT）。
- ask.mjs 自动：检查环境 → 连接检查（连不上 / 窗口不存在**立刻报错**，不干等 10 分钟）→ 发消息（开头自动附本机名片）→ 等对方处理 → 拉回答复（末尾最新）。**把答复转给用户。**
- **一句话记住 `--async` 和 `--replies`**：**`--async` 管"发"（发完就走），`--replies` 管"收"（只拉不发送）**；不加 `--async` 就是默认那条——阻塞等到答复（最长 10 分钟），**其它都不用记**。
- **不想干等 → `--async`（发完就走）**：立即返回；消息尾附一句【说明】——"我会来拉取；你装了 skill 也可主动发我（可选）"。**收答复默认走拉取**：`ask.mjs --replies <LINK> <AGENT>`；对方若主动发了（装了 skill），会作为消息进你窗口——当惊喜，不当承诺。群发也能配 --async。
  - **拉取节奏（模型自己掌握，程序无定时器）**：发完这轮就结束（告诉用户"已发出"）；之后用户问"收答复/对方回了没"、或你觉得该收了 → `--replies` 拉一次（还没好就过会儿再拉）；想等就 `sleep 60 && node ... --replies ...` 一条命令先等再拉。
- 发送成功 ask.mjs 会**自动记住对方**：带 `NAME=` 的名片进**名册**（`~/.paseo-peers.json`，可存多台，`--peer <名字>` 查）；同时更新**"最近一次"**兜底文件（`~/.paseo-peer*`，没点名的"问远程"用它）。
- 名册管理：`--list` 看存了哪些（**最近使用在前、带一句话介绍**，方便挑；只列名字+窗口ID，链接不显示）；`--remember "<名片>"` 手动存一张（不发送）。
- 之后要再问 → **点名就稳**："问 <名字>" → `--peer <名字> "问题…"`；或名片照抄。

## ③ 回答（对方连过来了）

收到 `【来自X】` + 名片块的消息 = 对方 agent 自动提问（不是人类追问），**按对话约定正常干活回答、结论放最后**——不管对方是阻塞等（默认）还是 `--async` 发完就走（消息尾会带【说明】），**你这边的动作完全一样：答完就行**，对方会来拉。

顺手把名片存一次：`node <skill目录>/scripts/ask.mjs --remember "<名片>"`——**每台存一次就够**（别每条都存；身份按 pair+agentid 认，重复存=刷新信息、不会多出条目），防会话被压缩后丢坐标。以后点名"问 <NAME>"就能主动找它（走 ②）。

可选：本机也装了 skill 时，可以主动把结论推回给发起方（**失败就算了，别当任务**）：

```bash
node <skill目录>/scripts/ask.mjs --no-wait --no-card <对方LINK> <对方AGENT> "<一句话结论>"
```

## 链接泄漏了怎么办（换新链接）——危险操作，严格口令

配对链接 = 本机身份（`PASEO_HOME` 里的 `server-id` + `daemon-keypair.json`）推导出来的，所以"换链接 = 换身份"。

**触发规则（必须全部满足，缺一不可）：**

1. **唯一触发口令：`/agent-penpal reset pair`**（带了 skill 名，整串完整出现即可：斜杠可有可无、大小写不敏感、空格数量随意）。只有用户明确打出这串，才进入本流程。**其它任何说法都不算**——中文（"换新链接""重置身份"）不算，感觉像的（"链接好像不对""换个链接试试"）更不算：日常用语太容易撞。遇到就问一句"要换的话请明确输入口令：`/agent-penpal reset pair`"，然后按默认出名片。
2. 执行前**必须二次确认**：先复述代价——所有对端失效（对方要换新名片）、daemon 重启、正在跑的窗口中断、**对话窗口 agentid 不变**——然后问"确认现在换？"。
3. 用户明确回复确认后，才运行（两个开关缺一律不动）：

```bash
node <skill目录>/scripts/setup.mjs --rotate --confirm
```

**默认调用永远是只读的**：不带参数 = 只出名片（读当前 pair + agentid）。rotate 是唯一会改身份的操作，单给 `--rotate` 不带 `--confirm` 脚本会直接拒绝退出。

其他信息：

- 效果：**老链接立即失效**（relay 上老路由没了），生成新名片；旧身份文件自动备份成 `.bak-<时间>`。
- 代价：所有对端一起失效——对方存的旧名片/名册旧条目连不上了（连接检查会报错，不会静默发错地方）；互发新名片即可恢复。
- **agentid 不变**：rotate 只换身份不换窗口；重启后窗口记录和历史都在，发消息自动续聊（Paseo 的 resume 机制）。
- 别在 Paseo agent 窗口里对本机 daemon 做（重启会停掉自己的会话）——脚本会拦住并退出；确认要做加 `--force`。
- 注意：`paseo daemon set-password` **管不了这条路**——relay 连接不走 daemon 密码校验，链接本身就是唯一凭证（这就是"当密钥保管"的原因）。
- 手动版（脚本不能用时）：`paseo daemon stop` → 把 `<PASEO_HOME>/server-id` 和 `<PASEO_HOME>/daemon-keypair.json` 改名/删除 → `paseo onboard --voice disable --timeout 240` → `paseo daemon pair --json`。本地 CLI 没有现成的 rotate 命令，就这四步。

## 给已有窗口换模型（不动名片）

**什么时候需要**：窗口的模型在你网关/端点上不存在，表现是"**窗口起来了、消息也投递成功，但永远没有答复**"。典型场景：paseo 默认挑的是内置 manifest 里的 Claude 原生名（`claude-opus-5-5` 之类），而你的自建网关只认自己那套名字。

```bash
node <skill目录>/scripts/switch-model.mjs <窗口ID|前缀> <新模型名>
# 先看有哪些窗口：      paseo ls -a -g --json
# 先看模型名能填什么：  paseo provider models claude
# 只看计划不动手：      加 --dry-run
```

**为什么需要专门的脚本**（三条死路都实测过）：daemon 的权威状态在**内存**里，磁盘只是它写出去的副本。所以"改文件 + `agent reload`"会被覆盖，"`agent stop` + 改文件 + reload"也一样。可行做法只有：**停 daemon → 改齐 5 处 → 起 daemon**。5 处分别是 `agents/*.json` 里的 `config.model` / `runtimeInfo.model` / `runtimeInfo.extra.runtimeModel` / `persistence.metadata.model`，以及 `creations/*.json` 里的 `snapshot.agent.model`（daemon 启动时是从这个 snapshot 恢复的）。

- **安全**：全程备份 → 改 → 停/起 → `inspect` 校验；**没生效会自动回滚并重新起 daemon**，不会留下半改状态。
- **自动脱钩（很重要）**：agent 进程是 **daemon 的子进程**（实测确认），所以脚本要是跑在 daemon 底下（典型情况：你就从某个对话窗口里调它），`daemon stop` 会把**脚本自己一起杀掉**——永远走不到"起 daemon"，那台机器就留在失联状态。脚本会检测到这点并**先把自己转成独立进程**再干活，命令立即返回，结果看 `<PASEO_HOME>/switch-model.log`。等约 20 秒自己回来校验即可。
- **代价**：会停再起一次 daemon，**正在跑的窗口（含对话窗口）会中断**；但 **agent ID 和 LINK 都不变** → 名片不用重出、对方不用重新配对，重发一次消息就续上。目标窗口就是你自己所在的窗口时脚本会先拦住提醒（加 `--force` 才继续，脱钩机制会保证它跑得完）。
- **风险**：这是改 paseo 的内部状态文件，**跨版本可能变 schema**。脚本会校验，失败就回滚；真要长期用，优先用 paseo 界面里的模型选择器（那里走的是 daemon 的正规接口）。
- 顺带：**`paseo agent reload` 不会改窗口 ID**（实测），所以它不算"重新生成名片"。

## 对话约定（防死锁）

1. **严格轮流**：问 → 答 → 问 → 答。发起方阻塞等答复（最长 10 分钟），这期间别再往对方发新消息。（`--async` 模式例外：发完就走、不等——先记下坐标，回头 `--replies` 拉。）
2. 要反问对方：写在**本轮答复的最后**，不要中途发消息——两边会互等卡死。
3. 结论放回复最后（对方 `logs --tail` 抓尾部最省事）。

## 名片格式（Card — 纯 ASCII，整块照抄即通）

```
=== PENPAL CARD ===
NAME=电脑
DESC=PC 端对话窗口：有安卓源码和 adb，可代查安卓构建/日志问题
LINK=https://app.paseo.sh/#offer=……
AGENT=<对话窗口短ID>
==================
```

包边、`NAME=`、`DESC=` 都是给人/名册看的，**认 `LINK=`/`AGENT=` 两行**就够（老卡片没有 NAME/DESC、旧包边 `=== 名片 ===` 都认）。`DESC=` 可选（≤200 字的一句话"我是干嘛的"）——配对时对方一眼知道你能帮什么；没有这行也完全正常。

> **一张名片 = 一个「机器 + 会话」**：`LINK` 是那台机器的身份（`paseo daemon pair` 生成，一台一个），`AGENT` 是具体哪个对话窗口。通常每台出一张就够；**同一台机器上想换别的会话参与，就再出一张**（LINK 相同、AGENT 不同）。名册的主键也是 `link|agent`，跟这个一致。

## 脚本路径写法

| 环境 | 写法 |
|---|---|
| Linux / macOS / Git Bash | `~/.claude/skills/agent-penpal/scripts/setup.mjs` |
| Windows cmd | `%USERPROFILE%\.claude\skills\agent-penpal\scripts\setup.mjs` |
| Windows PowerShell | `$HOME\.claude\skills\agent-penpal\scripts\setup.mjs` |

（ask.mjs 同目录。）整个 skill 目录拷到别的机器、对应 agent 里就能用——脚本纯 Node，只依赖 paseo CLI（`npm i -g @getpaseo/cli`，Node 18+）。

## 排查

| 现象 | 解法 |
|---|---|
| 提示找不到 paseo | 脚本会依次找 `$PASEO_CLI` → PATH → 桌面 App 自带那份。都没找到才是真没有：Node 18+；`npm i -g @getpaseo/cli`。装过还报找不到 = npm 全局 bin 不在 PATH（`npm prefix -g` 拿目录，Unix 加 `/bin`；`npm bin -g` 已在 npm 9+ 删除）。只装了桌面 App 的，软链 App 里那份即可（见"装到一台新机器"） |
| **Windows + Git Bash**：`which paseo` 能跑，脚本却说"找不到 paseo CLI" | Git Bash 的 PATH 可能是 POSIX 形式（`/d/work/...`），或 `paseo` 带 `.cmd` 后缀——早期版本这两种都探测不到。**新版已修**（PATH 转译 + 不再重复拼扩展名）。旧版应急：`PASEO_CLI='D:\path\to\paseo.cmd' node ask.mjs …` |
| `--peer <名字>` 说"名册里没有" | 名字得**先入册**：收到名片后跑一次 `ask.mjs --remember "<名片>"`，之后"问 <名字>"才能点名。报错里会列出名册现在有谁。不想存就直接贴 LINK：`--host <LINK> --agent <AGENT>` |
| 配了自启，`paseo daemon status` 还是 not running | 多半是用了 `daemon start --foreground`——**这个参数已被移除**，要托管的是 **`<paseo 绝对路径> daemon run`**（见"让 daemon 一直在线"）。另外两个常见原因：只写了 `paseo` 没用绝对路径（守护进程不读 shell 的 rc，PATH 里没有它）；Linux 没做 `loginctl enable-linger "$USER"` |
| 配对链接泄漏了 | `setup.mjs --rotate` 换新身份：老链接立即失效、所有对端换新名片（见"链接泄漏了怎么办"） |
| 对端说"连不上你" | 可能你刚 --rotate 换过身份；把新名片重发给他 |
| 想不起存过哪些远程 | `ask.mjs --list`（列名字+窗口ID，链接不显示）；点名发送 `--peer <名字>`——**名字重了不会替你猜**，会把候选列出来让你挑，选定后用 `--agent <窗口ID>` 重发 |
| ask.mjs 报"连不上对端" | LINK 抄错 / 对方 daemon 没跑 / relay 或网络不通；核对无误可 `--no-check` 跳过检查 |
| ask.mjs 报"对端没有窗口 X" | AGENT 抄错或窗口被删；报错里列了对方现有窗口；让对方重跑 setup.mjs 出新名片 |
| 发完超时 | 对方窗口在忙或没开；ask.mjs 自动再等一轮，之后重试 |
| 对方窗口"卡住"没动静 / ask.mjs 报 permission | 窗口在等权限审批：**直接远程切模式** `paseo agent mode <窗口ID> bypassPermissions --host "<链接>"`（最省事）；或 `paseo permit ls --host "<链接>"` 看、`paseo permit allow <窗口ID> --all --host "<链接>"` 放行。新开窗口已默认 bypass |
| **窗口起来了、消息也投递成功，但永远没有答复**（对方 agent 像是没收到 / 一直卡） | 大概率是**模型名那边的机器不认**。自查两条：`paseo agent inspect <窗口ID> --json`（看 Model）和 `paseo provider models claude`（看 paseo 眼里有哪些）。**根因**：paseo 建窗口时若没显式给模型，会用它内置 manifest 挑一个 Claude 原生名（按 `defaultPriority` + 本机 Claude Code 版本过滤，如 `claude-opus-5-5`），**完全不读 `settings.json`**——settings.json 里的模型只会被追加进"可选列表"，永远不带 `isDefault`。自建网关（或任何非 Anthropic 官方端点）下那个原生名多半不存在，进程就发不出请求。**解法**：出新名片时让脚本自己从本机 cc 配置读（新版 `setup.mjs` 默认这么做），或建窗口时 `--model <网关认的名字>` 手动指定。**窗口已经建好了**才发现的，用 `switch-model.mjs <窗口ID> <新模型名>` 换（见"给已有窗口换模型"）。**改 `settings.json` 是没用的**（已实测+源码确认），因为模型在**建窗口那一刻**就写死进 agent 记录的 `config.model`，之后没有任何代码重新解析（`paseo agent update` 连 `--model` 参数都没有） |
| --async 发出后怎么收答复 | `ask.mjs --replies <LINK> <AGENT>` 拉对方窗口最新内容（结论通常在末尾）；对方装了 skill 也可能主动发进你窗口（可选） |
| 提示"本条未附名片" | 拿不到本机对话窗口ID；先跑 setup.mjs |
| 两边互等卡死 | 违反严格轮流（被问方中途发了消息）；各自超时重来，反问写答复末尾 |
| setup.mjs 窗口开去了别的 daemon | 环境里 PASEO_HOST/PASEO_LISTEN 劫持 run/ls；setup.mjs 已自动剥掉并钉在本机 daemon，手动敲 paseo 命令时注意 |
| setup.mjs 说"配对链接没生成" | **先看它打出来的 paseo 原始输出**（脚本会按原因给不同提示，别一律当成 relay 问题）。真 relay 关着：在 PASEO_HOME 的 config.json 设 `"relayEnabled": true` → `paseo daemon restart` → 重跑。若是 `TARGET_AMBIGUOUS` = `PASEO_HOME` 和 `PASEO_HOST` 环境变量同时存在，清掉一个再跑（新版脚本已不再自己制造这个冲突） |

脚本不能用时手动三连（同 ask.mjs 原理）：

```bash
paseo ls -a -g --json --host "<LINK>"       # 找窗口短ID
paseo send <短ID> --host "<LINK>" "问题……"   # 只返回状态（completed/timeout/permission），不含答复正文
paseo logs <短ID> --tail 40 --host "<LINK>"  # 取答复正文
```

更多参数：`node <脚本> --help`。
