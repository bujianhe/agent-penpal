# 各平台的登记信息 / Per-marketplace listings

**以 GitHub 为主源。** 其它平台都从这里同步——改完这里、推上去，再照下表逐平台更新。

新增平台时：在下面加一节，写清**登记了哪些字段、值是什么、怎么更新（能 API 还是必须网页）**。

---

## 0. GitHub（主源）

| 字段 | 值 |
|---|---|
| 仓库 | `bujianhe/agent-penpal` |
| 可见性 | public |
| description | `Let the AI agents on two machines talk to each other. No public IP, no port forwarding, no VPN — built on Paseo's E2EE relay. 有什么，和我的 agent 说去吧。` |
| topics（20） | `a2a` `agent-bridge` `agent-communication` `agent-connector` `agent-skills` `agent-to-agent` `ai-agents` `claude` `claude-code` `claude-plugin` `codex` `cross-machine` `mcp` `messaging` `model-context-protocol` `multi-agent` `multi-machine` `openclaw` `paseo` `remote-agent` |

**权威文案在仓库里**（改文案时改这些文件，别在平台后台各改各的）：

- `SKILL.md` 的 frontmatter `description` —— 也决定 skills.sh 搜索、也是千问简介的默认值（上限 200 字）
- `README.md` / `README.en.md` —— 人看的门面
- `docs/promo.md` —— 发群用的短文案

**更新方式**：`git push` 即可。

---

## 1. skills.sh

| 字段 | 值 |
|---|---|
| 页面 | https://www.skills.sh/bujianhe/agent-penpal/agent-penpal |
| 收录机制 | **自动**，靠 `npx skills add` 的匿名安装遥测 |
| 可填字段 | **无**（没有提交表单） |

**描述从哪来**：页面直接读仓库里 `SKILL.md` 的 `description`。

**更新方式**：推 GitHub 即可，页面跟着变。收录要等有人真的 `npx skills add` 过。

---

## 2. 魔搭 ModelScope

| 字段 | 值 |
|---|---|
| 页面 | https://www.modelscope.cn/skills/luohou/agent-penpal |
| `owner` | `luohou`（**创建后不可改**） |
| `skill_name` | `agent-penpal`（**创建后不可改**） |
| `display_name` | `agent-penpal` |
| `category` | `developer-tools` |
| `license` | `MIT`（**必须显式传**，不填默认 Apache-2.0） |
| `source_url` | `https://github.com/bujianhe/agent-penpal` |
| `description` | 见下面的「魔搭专用简介」 |
| `tags` | `cross-machine` `agent-to-agent` `multi-agent` `claude-code` `codex` `paseo` `跨机器` `联调` `多机协作` `远程agent` `内网穿透` |

**魔搭专用简介**（177 字）：
> 让两台机器上的 AI agent 直接互相说话——一边够不着的东西，它自己去问另一边。不用公网 IP、不用端口映射、不用内网穿透，也不用 SSH。三步完成配对：装 skill → 出名片 → 把名片发给对面，之后 agent 自己一问一答，你只看结论。可装进 20+ 种 agent（实测 Claude Code / Codex / OpenClaw）。

**更新方式**（API，可脚本化）：

```bash
# 1) 打包（根目录恰好 1 个 SKILL.md）
git archive --format=zip -o /tmp/agent-penpal.zip HEAD
# 2) 上传拿 file_id
curl -s -X POST https://modelscope.cn/openapi/v1/files/upload \
  -H "Authorization: Bearer $MODELSCOPE_API_TOKEN" \
  -F "file=@/tmp/agent-penpal.zip" -F "type=skill"
# 3) PATCH 更新（只传要改的字段）
curl -s -X PATCH https://modelscope.cn/openapi/v1/skills/luohou/agent-penpal/settings \
  -H "Authorization: Bearer $MODELSCOPE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"skill_file":"<file_id>"}'
```

> **坑**：创建时传的 `tags` 会被**吞掉**，只有 PATCH 能写进去，并且读回来带 `custom_tag:` 前缀。所以更新 tags 要单独 PATCH 一次。

---

## 3. 千问（Qwen）

| 字段 | 值 |
|---|---|
| 技能市场 | https://www.qianwenai.com/hub/skills （首页有「Skill 发布」入口） |
| 管理 | https://www.qianwenai.com/hub/skills/manage |
| 发布文档 | https://platform.qianwenai.com/docs/agent-infra/skills/publish |
| 英文标识 | `agent-penpal` |
| Skill 名称 | `agent-penpal` |
| **简介（≤200 字）** | 见下面的「千问专用简介」 |
| 版本 | `0.2.0` |
| 开源协议 | `MIT`（**只能选 MIT 或 Apache-2.0**） |

**千问专用简介**（171 字）：
> 让两台机器上的 AI agent 直接互相说话——一边够不着的东西，它自己去问另一边。不用公网 IP、不用端口映射、不用内网穿透，也不用 SSH。三步配对：装 skill → 出名片 → 把名片发给对面，之后 agent 自己一问一答，你只看结论。可装进 Claude Code / Codex / Cursor 等 20+ 种 agent。

**更新方式**：**只有网页流程，没有 API**（api-ref 里没有任何 skill 发布接口）。流程：
登录 → 设"技能市场个人名称"（首次）→ **实名认证**（个人/企业，只能本人做）→ 拖入 ZIP → 填资料 → 提交审核（安全检测 → 人工审核 → 上线）。

> 简介字段默认会带出 `SKILL.md` 的 description，但我们是 312 字、**超过 200 上限**，所以必须在表单里手动换成上面那份 171 字的。

---

## 4. Claude Code 插件市场（仓库自带）

| 字段 | 值 |
|---|---|
| 装法 | `claude plugin marketplace add bujianhe/agent-penpal` → `claude plugin install agent-penpal@agent-penpal` |
| 市场名 / 插件名 | `agent-penpal`（**发布后不可改**） |
| 版本 | **故意不设** —— git 托管下每次 push 即新版本 |

**更新方式**：推 GitHub。用户 `claude plugin update agent-penpal@agent-penpal` 取新版（自动更新第三方市场**默认关闭**，用户需在 `/plugin` → Marketplaces 里自己开）。

---

## 更新清单（改完文案照着走一遍）

- [ ] `git push`
- [ ] 魔搭：重新打包 → 上传 → PATCH（**tags 记得单独 PATCH**）
- [ ] 千问：网页重新提交（简介若改动，注意 ≤200 字）
- [ ] skills.sh：**不用做**，自动跟 GitHub
- [ ] Claude Code 插件市场：**不用做**，用户 `plugin update` 即可

## 明确不上架的平台

- **ClawHub** —— 被查出 341 个恶意 skill 分发 AMOS 窃密木马（Snyk 数到 1467 个）。上去不但没收益，还有品牌风险。
- **Coze（扣子）技能商店** —— 它的 Skill 是给**云端 bot**的能力包，够不着用户本机的 paseo daemon，场景对不上。
