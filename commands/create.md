---
description: 生成这台机器的配对名片（对方拿到就能找到你）
argument-hint: [本机名字，比如 电脑]
allowed-tools: ["Bash", "Read"]
---

用 `agent-penpal` skill 的「① 出名片」流程。

1. 先按 SKILL.md 的「脚本路径写法」定位 **skill 目录**，脚本是 `<skill目录>/scripts/setup.mjs`
   （插件安装通常在 `~/.claude/plugins/cache/<marketplace>/agent-penpal/<版本>/`；也见下方"定位脚本"）
2. 执行：

```bash
node <skill目录>/scripts/setup.mjs
```

如果用户给了名字，加 `--name "<名字>"`（名字来自 `$ARGUMENTS`）。

3. **把脚本打印的名片原样转给用户**——不要改写、不要自己拼 LINK/AGENT。
4. 脚本报错就按 SKILL.md 的「排查」处理；缺依赖（Node / paseo CLI）**自己装，别让用户装**。

**不要跳过脚本手写名片。** LINK 是由本机 daemon 身份（`server-id` + `daemon-keypair.json`）推导出来的，手拼必错。

---

**定位脚本**（如果不知道 skill 目录在哪）：

```bash
ls -d ~/.claude/plugins/cache/*/agent-penpal/*/scripts/setup.mjs 2>/dev/null | tail -1
```

（老式 skill 安装在 `~/.claude/skills/agent-penpal/scripts/setup.mjs`。）
