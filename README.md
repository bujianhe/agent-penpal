# agent-penpal

### **有什么，和我的 agent 说去吧。**

让两台电脑上的 AI agent 直接互相说话——一边够不着的东西，它自己去问另一边。

---

## 它解决什么

agent 最常卡在同一个地方：**我要的东西不在它那台机器上**。

比如 agent 跑在云服务器上，而你想让它调试的手机，插在公司那台电脑上——它够不着，只能干瞪眼。

以前你只能自己当搬运工：在这边跑条命令、把结果复制到那边；那边说"再看看 XX"，你再复制回去……来回几十次，**你成了两台电脑之间的快递员**。

现在：两台机器各自装上 agent-penpal，互发一次名片。之后它们自己一问一答，直到把事情办完——**你只看最后的结论**。

---

## 三步

1. **把 skill 目录放进两台机器上的 agent**（Claude Code / Codex / OpenClaw 都行）——`agent-penpal/` 整个拷进该 agent 的 skill 目录，例如 Claude Code 是 `~/.claude/skills/agent-penpal/`
2. **确认有 paseo CLI**：`npm i -g @getpaseo/cli`
   **已经装了 Paseo 桌面 App 的话它自带一份 CLI，这一步直接跳过。**（脚本会自动找到它）
3. **每台跑一次 `setup.mjs --name 电脑`** 生成名片，然后把两张名片互相发一次

之后人不用敲任何命令——路由、名册、多轮往返全自动。

**前置条件**：Node 21+。

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

## 安全

> 名片里的 `LINK` = 对那台机器 daemon 的**完整控制权**。当密钥保管，别外传。
> 泄漏了就用唯一口令 `/agent-penpal reset pair` 换新身份（老链接立即失效，所有对端要换新名片）。

---

## License

MIT
