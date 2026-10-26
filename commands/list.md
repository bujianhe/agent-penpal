---
description: 列出名册里存过的远程机器（名字 / 窗口ID / 最后使用）
allowed-tools: ["Bash"]
---

执行：

```bash
node <skill目录>/scripts/ask.mjs --list
```

把结果整理成一张小表给用户：**名字 / 窗口ID / 最后使用时间**。
如果名册是空的，告诉用户：收到对方名片时跑一次 `ask.mjs --remember "<名片>"` 就能存进来。
