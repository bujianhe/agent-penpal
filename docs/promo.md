# 宣传语 / Promo copy

发群、发朋友圈、发推用。改的时候注意跟 README 保持一致的口径：
**不用 SSH** 是主卖点；"不挑 agent" 放后面；不提任何竞品名字。

---

## 中文

搞了个让两台机器上的 agent 能自己联调的 skill：**github.com/bujianhe/agent-penpal**

起因：联调时一部分功能在无影云，手机连着本地 PC，两边 Claude Code 的结论老要我人肉来回拷，觉得挺麻烦。

**三步解放双手：**
① 两台机器都装上 skill，把 github 地址丢给它就行
② 挑一台（A）执行 `/agent-penpal`——第一次它会装依赖，稍微久一点，然后吐出一张名片
③ 在 B 里 `/agent-penpal` + 那张名片，两台 agent 就自己勾搭上了

之后直接说任务就行，**会话新开或沿用现有的都可以**。

**不用公网 IP、不用端口映射、不用内网穿透，也不用 SSH**——两台机器只要能上网就行。
也不挑 agent：Claude Code / Codex / OpenClaw 都行。

**还能这么用：**
1. 和别人联调——划分好边界，两个 agent 自己分工
2. 回家了给公司电脑派活，家里电脑做验收指导
3. SDK 支撑——在仓库下开个会话，把配对连接丢给集成方：「**有什么问题，和我的 agent 说去吧**」

---

## English

Made a skill that lets the agents on two machines work together: **github.com/bujianhe/agent-penpal**

The problem: half our stack runs on a cloud box, the phone is plugged into a local PC, and I kept hand-copying findings back and forth between the two Claude Code sessions.

**Three steps:**
① Install the skill on both machines — just give the agent the GitHub URL
② Run `/agent-penpal` on one (A) — the first run installs dependencies, takes a moment, then hands you a card
③ On B, run `/agent-penpal` plus that card — the two agents are talking

After that, just describe the task. **A new session or an existing one, either works.**

**No public IP, no port forwarding, no tunneling, no SSH** — the two machines just need internet access.
And it isn't picky about the agent: Claude Code, Codex, OpenClaw.

**Other ways to use it:**
1. Pairing up on an integration — agree on the boundary and let the two agents split the work
2. Handing off work from home to the office machine, and verifying from home
3. SDK support — open a session in the repo and hand the pairing link to whoever's integrating: "**Need something? Go ask my agent.**"
