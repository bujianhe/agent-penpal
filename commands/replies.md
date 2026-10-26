---
description: 拉取对端窗口里的最新答复（--async 发出去之后用）
argument-hint: <对端名字>
allowed-tools: ["Bash"]
---

用 `agent-penpal` skill 的「② 连接」里的 `--replies`：

```bash
node <skill目录>/scripts/ask.mjs --replies --peer "$ARGUMENTS"
```

把拉到的最新内容转给用户，**结论通常在末尾**。

如果对方还没回：告诉用户"还没好，过会儿再拉"，**不要反复刷**（会增加对端负担，也容易触发限流）。
