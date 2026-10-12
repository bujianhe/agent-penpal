# agent-penpal

### **有什么，和我的 agent 说去吧。**

让两台电脑上的 AI agent 直接互相说话——一边够不着的东西，它自己去问另一边。

---

## 它解决什么

agent 最常卡在同一个地方：**我要的东西不在它那台机器上**。

比如 agent 跑在云服务器上，而你想让它调试的手机，插在公司那台电脑上——它够不着，只能干瞪眼。

以前你只能自己当搬运工：在这边跑条命令、把结果复制到那边；那边说"再看看 XX"，你再复制回去……来回几十次，**你成了两台电脑之间的快递员**。

现在：两台机器各自装上 agent-penpal，**递一张名片过去**，它们就会自己一问一答，直到把事情办完——**你只看最后的结论**。

---

## 安装

```bash
# 方式一：插件市场（推荐）
claude plugin marketplace add bujianhe/agent-penpal
claude plugin install agent-penpal@agent-penpal
```

或**方式二：手动拷目录**——把 `agent-penpal/` 整个放进你的 agent 的 skill 目录（Claude Code 是 `~/.claude/skills/agent-penpal/`）。没 skill 机制的 agent（纯 AGENTS.md / 系统提示）：把 [SKILL.md](SKILL.md) 的正文贴进去一样生效。

两边机器都要装。

---

## 三步

**人只搬一张名片。**

1. **两台机器各装一次**（见上「安装」）
2. **各自说一句「出张名片」** —— 缺 Node、缺 paseo CLI，agent 自己装齐，把名片递给你
3. **把一张名片发给对面**，让它连过来

连上之后**就是双向的**：对面发第一条消息时，**它自己的名片会自动附在消息开头**，所以两台都拿到了对方的坐标——**名片你只需要搬一次**。

**不用专门准备窗口**：在 Paseo 的会话里跑就用**当前这个**；在普通终端里跑，它会自己开一个（或沿用上次那个）常驻窗口——不用你操心。

> 第 2 步是重点：**你不用先装 paseo**。装着 Paseo 桌面 App 的话它本来就自带 CLI；没装的话 agent 会按 [SKILL.md](SKILL.md) 的指示 `npm i -g @getpaseo/cli`，装完接着往下走。

---

## 不需要公网 IP

不需要公网 IP、端口映射、内网穿透、VPN。

公网可达走 **Paseo 自带的端到端加密 relay**（built on Paseo）。frp / ngrok / Tailscale / 反向 SSH 都在解决"两边怎么打通"——而这里，打通是内置的。

---

## 用起来是什么样

出名片（每台机器一次）：

```bash
node setup.mjs --name 电脑
```

把打印出来的名片发给对方，对方存下就能主动找你。之后互相问事：

```bash
node ask.mjs --peer 电脑 "你那边构建过了吗？"
```

长任务不想干等：`--async` 发完就走，之后 `--replies` 收答复。

其余参数见 `node <脚本> --help`，或直接读 [SKILL.md](SKILL.md)。

---

## 你可能在搜这些

跨机器 agent · 两台电脑的 AI 互相通信 · agent connector · agent-to-agent（A2A）· MCP 之外的 agent 互联 · 不用公网 IP 的远程 agent · Claude Code / Codex / OpenClaw 跨主机 · remote agent daemon · 多机协作 · 让 AI 自己互相问

---

## 安全

> 名片里的 `LINK` = 对那台机器 daemon 的**完整控制权**。当密钥保管，别外传。
> 泄漏了就用唯一口令 `/agent-penpal reset pair` 换新身份（老链接立即失效，所有对端要换新名片）。

---

## 免责声明

**本项目与 Paseo 没有隶属关系，也未经其认可。**

agent-penpal 是独立的第三方工具：它只是**调用** Paseo 的 CLI（子进程），本仓库**不含任何 Paseo 代码**。Paseo 采用 Apache License 2.0（© Mohamed Boudra）；该许可**不授予商标权**——这里提到 "Paseo" 仅用于说明依赖关系。

---

## License

MIT
