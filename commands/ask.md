---
description: 给另一台机器发消息并等答复（A2A）
argument-hint: <对端名字> <消息…>   — 或直接贴对方名片
allowed-tools: ["Bash", "Read"]
---

用 `agent-penpal` skill 的「② 连接」。

**先按这个优先级选传法**（越靠前越不容易错）：

1. `--peer <名字>` —— 名册里已经有这台（名字 = 名片上 `NAME=` 那行）
2. **整块粘名片** —— 名册里没有、但上下文有名片时，**整块原样贴**，不要手抄字段
3. `LINK` + `AGENT` 分开传 —— 兜底，最容易错

定位脚本：`<skill目录>/scripts/ask.mjs`（见 SKILL.md「脚本路径写法」；插件装在 `~/.claude/plugins/cache/*/agent-penpal/*/`）。

```bash
node <skill目录>/scripts/ask.mjs --peer "<名字>" "<消息>"
```

参数来自 `$ARGUMENTS`。如果用户给的是名片，把整块名片作为第一个参数传进去。

**拿到答复后**：
- 把答复转给用户，**结论通常在末尾**
- 连不上会**自动重试 3 次**（relay 链路会抖）；还失败就按 SKILL.md「排查」处理，别急着下结论说"对方挂了"
- 发送成功会自动记住对方坐标，下次就能用 `--peer <名字>`

**别做的事**：不要 SSH 过去自己扒日志——对端 agent 会读日志、会分析，直接问它就要结论（见 SKILL.md「A2A 和 SSH 的分工」）。
