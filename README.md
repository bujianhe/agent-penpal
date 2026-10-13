# agent-penpal

### **有什么，和我的 agent 说去吧。**

让两台电脑上的 AI agent 直接互相说话——一边够不着的东西，它自己去问另一边。

---

## 30 秒看懂

两台机器，两个 agent。你在其中一台上说一句话：

```
你（对 A 机的 agent）> 给电脑那边出张名片

  → 环境检查通过：Node v22.11 · paseo CLI 0.11.0
  → 本地 daemon 已在跑 · 配对链接 OK
  ✓ 完成
    === PENPAL CARD ===
    NAME=Mac Mini
    DESC=macOS 端：有 Android SDK 和 adb，查构建、抓日志找我
    LINK=https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6…
    AGENT=9e1e401
    ==================
```

把这张名片贴到 B 机的 agent 里——**配对完成**。

然后就直接说任务：

```
你（对 A 机的 agent）> 问一下电脑那边，登录接口改完之后构建过了没

  → 发送给窗口 9e1e401…等对方处理…
  → send 状态: completed
  ========== 答复开始 ==========
  构建过了，昨天下午那次。顺手把一个 flaky test 也修了。
  ========== 答复结束 ==========
```

**中间没有人在搬。** 那两段消息，从头到尾是两台机器上的 agent 自己问、自己答的。

---

## 它解决什么

程序员最耗时间精力的活，联调排得上号。**耗的往往不是写代码，是在两边之间搬运信息。**

两台机器各跑一半，一出问题就是来回切：

- 在 A 上看日志 → 复制 → 切到 B 贴过来问"是不是你这边的？"
- B 说还得再看某个值 → 你回 A 再跑一遍 → 再复制、再切回去
- 服务在云上、手机插在这台、代码在那台……每多一个环境，就多一条人肉链路
- 一天下来真正写代码没多少，剩下全在当**两台机器之间的人肉消息总线**

**可如果两边各自都有 AI agent，为什么还要人来搬？**

装上 agent-penpal，两台机器的 agent 就能**直接对话**——一边缺什么、要验证什么，直接问另一边，直到把事情办完。**你只看最后的结论。**

---

## 安装

**方式一：一条命令** —— `npx skills add bujianhe/agent-penpal`

它会一次装进你机器上它支持的各个 agent（20+ 家：Claude Code / Codex / Cursor / Cline / Copilot / Windsurf…）。

**我们没有任何 Claude Code 特有的东西**——脚本是纯 Node，规则写在 `SKILL.md` 里，不调哪家的私有 API。所以**能装进去、agent 能跑命令，就能用**。（端到端实测过三家：Claude Code / Codex / OpenClaw。）

**方式二：国内访问不了 GitHub 就用魔搭（ModelScope）**

```bash
npx skills add https://modelscope.cn/skills/luohou/agent-penpal
```

同一条 `npx skills add`，只是从魔搭拉（**不走 GitHub**，国内直连）。上面两种方式都要能访问 GitHub，这种方式不用。

**方式三：Claude Code 插件市场**

```bash
claude plugin marketplace add bujianhe/agent-penpal
claude plugin install agent-penpal@agent-penpal
```

**方式四：手动拷目录**——把 `agent-penpal/` 整个放进你的 agent 的 skill 目录（Claude Code 是 `~/.claude/skills/agent-penpal/`）。没 skill 机制的 agent（纯 AGENTS.md / 系统提示）：把 [SKILL.md](SKILL.md) 的正文贴进去一样生效。**完全不需要网络。**

**两边机器都要装。**

---

## 三步

**人只搬一张名片。**

1. **两台机器各装一次**（见上「安装」）
2. **各自说一句「出张名片」**（或直接 `/agent-penpal`）—— 缺 Node、缺 paseo CLI，agent 自己装齐，把名片递给你。**第一次会稍慢一点**，那是在装依赖。
3. **把一张名片发给对面**（在对面敲 `/agent-penpal`，后面贴上名片），让它连过来

连上之后**就是双向的**：对面发第一条消息时，**它自己的名片会自动附在消息开头**，所以两台都拿到了对方的坐标——**名片你只需要搬一次**。

**不用专门准备窗口**：在 Paseo 的会话里跑就用**当前这个**；在普通终端里跑，它会自己开一个（或沿用上次那个）常驻窗口——不用你操心。

**名片上那句"我是干嘛的"也不用你写。** 第一次出名片时自动生成：先读你当前目录的 `README.md` / `CLAUDE.md` / `AGENTS.md`，抓一句正经的职责描述；都没有才退回用当前会话的标题。生成后固定不变——于是对方一拿到名片就知道**这台机器能帮它干什么**，不用你解释。

> 第 2 步是重点：**你不用先装 paseo**。装着 Paseo 桌面 App 的话它本来就自带 CLI；没装的话 agent 会按 [SKILL.md](SKILL.md) 的指示 `npm i -g @getpaseo/cli`，装完接着往下走。

---

## 不需要公网 IP，也不需要 SSH

**不需要公网 IP、不需要端口映射、不需要内网穿透、不需要 VPN，也不需要 SSH。**

不用让一台机器网络可达、不用配隧道、不用管密钥、不用担心 IP 变了。

公网可达走 **Paseo 自带的端到端加密 relay**（built on Paseo）。frp / ngrok / Tailscale / 反向 SSH 都在解决"两边怎么打通"——而这里，打通是内置的。

---

## 和常见做法比

**我们最想省掉的是 SSH。** 不用让一端网络可达、不用配隧道、不用管密钥——**两台机器只要能上网就行**。

| 做法 | 关键前提 |
|---|---|
| 人肉复制粘贴 | 没有前提，代价是你的时间 |
| 反向 SSH 隧道 | 要 SSH 打得通（一端得网络可达）+ 隧道工具 |
| frp / ngrok | 公网服务器或账号 |
| Tailscale / VPN 组网 | 两端加入同一虚拟网 |
| **agent-penpal** | **两台机器能上网** |

---

## 用起来是什么样

**日常不用敲命令，跟 agent 说就行：**

| 你说 | 它做 |
|---|---|
| 「出张名片」 / `/agent-penpal` | 出名片（缺什么依赖它自己装） |
| `/agent-penpal` + 对方的名片 | 连上对方 |
| 「问一下电脑那边构建过了没」 | 自己找到对方、发消息、把答复带回来 |

> **一张名片 = 一个「机器 + 会话」**。LINK 是那台机器的身份，AGENT 是具体哪个会话。通常每台出一张就够；想换别的会话用，就再出一张（LINK 一样、AGENT 不同）。

底下是它替你跑的命令，想手动来也行：

```bash
node setup.mjs --name 电脑      # 出名片
node ask.mjs --peer 电脑 "你那边构建过了吗？"   # 主动问（默认阻塞等答复）
```

长任务不想干等：`--async` 发完就走，之后 `--replies` 收答复。

其余参数见 `node <脚本> --help`，或直接读 [SKILL.md](SKILL.md)。

---

## 还能这么用

- **和别人联调**：事先划好边界，两边的 agent 各管一半，自己对接、自己收敛问题，你只在最后看一眼。
- **远程派活**：回家了给公司电脑派个任务，家里这台做验收和指导——不用远程桌面，也不用挂 VPN。
- **SDK / 平台支撑**：在仓库下开个会话，把配对连接丢给集成方。对方卡住时就是那句话：「**有什么问题，和我的 agent 说去吧**」。
- **一台机器够不着另一台的东西**：真机插在这台、服务跑在那台、构建环境只在第三台——缺什么，就问有那台东西的 agent。

---

## 你可能在搜这些

跨机器 agent · 两台电脑的 AI 互相通信 · agent connector · agent-to-agent（A2A）· MCP 之外的 agent 互联 · 不用公网 IP 的远程 agent · 在 NAT 后面也能连 · zero-infrastructure · Claude Code / Codex / OpenClaw 跨主机 · remote agent daemon · 多机协作 · cross-harness · agent 消息总线 · 让 AI 自己互相问

---

## 安全

> 名片里的 `LINK` = 对那台机器 daemon 的**完整控制权**。当密钥保管，别外传。
> 泄漏了就用唯一口令 `/agent-penpal reset pair` 换新身份（老链接立即失效，所有对端要换新名片）。

---

## 依赖

本项目通过子进程**调用** Paseo 的 CLI（[Paseo](https://github.com/getpaseo/paseo) 采用 Apache License 2.0，© Mohamed Boudra）。仓库内**不含 Paseo 代码**。

---

## License

MIT
