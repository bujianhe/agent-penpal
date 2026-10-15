#!/usr/bin/env node
/**
 * setup.mjs — 冷启动：把这台机器变成一个"可以被跨主机对话"的节点。
 * 只用 Node + paseo CLI，不需要 Paseo 桌面 App。
 *
 * 一条命令做完四件事：
 *   1. 检查 paseo CLI（缺了提示 npm i -g @getpaseo/cli）
 *   2. 确保本地 daemon 在跑（paseo onboard；relay 默认开）→ 生成自己的配对链接
 *   3. 定好"对话窗口"：在 Paseo agent 窗口里跑 = 当前窗口；普通终端里跑 = 后台开一个常驻 agent
 *      （paseo run -d，默认 claude，--provider <任意 ACP provider> 可换，如 codex / cursor / gemini）
 *      模型：显式 --model > 本机 .claude/settings.json 里配的 > paseo 内置默认（--no-model 强制走这个）
 *   4. 坐标写进 ~/.paseo-self-link / ~/.paseo-self-agent / ~/.paseo-self，打印名片
 *
 * 用法:
 *   node setup.mjs --name 电脑                 # 一般就这一条
 *   node setup.mjs --name 电脑 --provider codex
 *   node setup.mjs --agent <已有窗口ID>         # 用现成窗口，不新开
 *   node setup.mjs --cwd <目录>                # 新开窗口的工作目录（默认用户主目录）
 *   node setup.mjs --desc "PC端对话窗口：有安卓源码和 adb，可代查安卓问题"   # 名片一句话介绍（可选，≤200字）
 *   node setup.mjs --home <PASEO_HOME> --port 6801   # 多开/测试用
 *   node setup.mjs --rotate                    # 链接泄漏了：换新链接（老链接立即失效，所有对端换新名片）
 *   node setup.mjs --dry-run                   # 只打印计划，不执行
 *
 * 做完之后:
 *   - 把打印的名片发给对方 agent，对方就能主动找本机
 *   - 本机找对方：node ask.mjs --host <对方LINK> --agent <对方AGENT> "…"
 *   - 看收到的消息：paseo logs <窗口ID> --tail 30（或 paseo attach <窗口ID> 实时看）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { guardMain, paseoRun, precheckPaseo } from "./lib-paseo.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASK_SCRIPT = path.join(SCRIPTS_DIR, "ask.mjs");

const HOME_DIR = os.homedir();
const FILE_SELF_LINK = path.join(HOME_DIR, ".paseo-self-link");
const FILE_SELF_AGENT = path.join(HOME_DIR, ".paseo-self-agent");
const FILE_SELF = path.join(HOME_DIR, ".paseo-self");
const FILE_SELF_DESC = path.join(HOME_DIR, ".paseo-self-desc");

// 新开对话窗口的启动语。刻意保持单行、无 ascii 引号与特殊字符：Windows 上参数要过 cmd.exe，
// 多行/引号会被搅乱。内容 = 让它知道自己是跨主机对话窗口 + 防死锁约定 + 便宜的首轮回复。
const BOOTSTRAP_PROMPT =
  "这是跨主机对话专用窗口：之后的消息可能来自另一台机器的 agent，开头带【来自X】和名片块。" +
  "处理约定：正常干活回答，结论放回复最后，不要中途主动发消息出去（对方正阻塞等答复，两边会互等）。" +
  "收到带名片的消息时把 LINK/AGENT 存好，以后能主动回找。现在请只回复四个字：联动窗口就绪";

// paseo 子进程的定位/环境/预检都在 lib-paseo.mjs（setup/ask 共用）。这里只留纯读文件的工具。
function readFileTrim(p) {
  try {
    return fs.readFileSync(p, "utf8").trim() || null;
  } catch {
    return null;
  }
}

// 本机 Claude Code 配的模型名。键名照抄 paseo 源码里的 CLAUDE_SETTINGS_MODEL_ENV_KEYS，
// 顺序按"用户显式指定"优先（ANTHROPIC_MODEL 是 cc 自己的默认模型）。
const CLAUDE_MODEL_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
];

function pickModelFromSettingsFile(file) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const top = typeof j.model === "string" ? j.model.trim() : "";
  if (top && top !== "default") {
    return { model: top, from: `${file} 的 model` };
  }
  const env = j.env;
  if (!env || typeof env !== "object") return null;
  for (const k of CLAUDE_MODEL_KEYS) {
    const v = typeof env[k] === "string" ? env[k].trim() : "";
    if (v) return { model: v, from: `${file} 的 env.${k}` };
  }
  return null;
}

/**
 * 读"这台机器打算用哪个模型"，用来在建对话窗口时显式传给 paseo。
 *
 * 为什么必须我们显式传：paseo 建 agent 时若没给模型，它会用**自己内置的 manifest**挑一个
 * Claude 原生名字（按 defaultPriority + 本机 cc 版本过滤），**完全不读 settings.json**
 * （settings.json 里的模型只会被追加进"可选列表"，永远不带 isDefault）。
 * 自建网关的环境下那个原生名字网关多半不认，窗口就起不来——表现为"对面连不上"。
 *
 * 顺序：项目 local > 项目 > 用户 local > 用户（照 Claude Code 自己的优先级），
 * 都没有再退回环境变量。
 */
function resolveClaudeModel(cwd) {
  const files = [];
  if (cwd) {
    files.push(path.join(cwd, ".claude", "settings.local.json"));
    files.push(path.join(cwd, ".claude", "settings.json"));
  }
  files.push(path.join(HOME_DIR, ".claude", "settings.local.json"));
  files.push(path.join(HOME_DIR, ".claude", "settings.json"));
  for (const f of files) {
    const hit = pickModelFromSettingsFile(f);
    if (hit) return hit;
  }
  for (const k of CLAUDE_MODEL_KEYS) {
    const v = (process.env[k] || "").trim();
    if (v) return { model: v, from: `环境变量 ${k}` };
  }
  return null;
}

// 首次生成简介用：从仓库的 README/CLAUDE.md/AGENTS.md 里提取第一段有信息量的正文
//（跳过 frontmatter、标题、徽章/图片、列表项），截到 200 字——纯读取，零模型参与
function extractRepoBlurb(dir) {
  for (const f of ["README.md", "CLAUDE.md", "AGENTS.md"]) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    text = text.replace(/^---[\s\S]*?\n---\s*\n/, ""); // 去 frontmatter
    for (const raw of text.split("\n")) {
      const ln = raw.trim();
      if (
        !ln ||
        ln.startsWith("#") ||
        ln.startsWith(">") ||
        ln.startsWith("```") ||
        ln.startsWith("|") ||
        ln.startsWith("[") ||
        ln.startsWith("!") ||
        ln.startsWith("<") ||
        /^[-*+]\s/.test(ln) ||
        /^\d+\.\s/.test(ln)
      ) {
        continue;
      }
      const blurb = ln.replace(/\s+/g, " ").slice(0, 200).trim();
      if (blurb.length >= 8) return blurb;
    }
  }
  return null;
}

function parseArgs(argv) {
  const o = {
    name: null,
    desc: null,
    provider: "claude",
    model: null,
    noModel: false,
    cwd: null,
    agent: null,
    home: null,
    port: null,
    dryRun: false,
    rotate: false,
    force: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") o.name = argv[++i];
    else if (a === "--desc") o.desc = argv[++i];
    else if (a === "--provider") o.provider = argv[++i];
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--no-model") o.noModel = true;
    else if (a === "--cwd") o.cwd = argv[++i];
    else if (a === "--agent") o.agent = argv[++i];
    else if (a === "--home") o.home = argv[++i];
    else if (a === "--port") o.port = argv[++i];
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--rotate") o.rotate = true;
    else if (a === "--confirm") o.confirm = true;
    else if (a === "--force") o.force = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else {
      console.error(`未知参数: ${a}（--help 看用法）`);
      process.exit(2);
    }
  }
  return o;
}

const HELP = `用法: node setup.mjs [选项]
  --name <名字>      本机在对话里的名字（默认沿用已存的，或主机名）
  --desc <一句话>    名片上的一句话介绍（≤200 字；不给就自动用对话窗口在 Paseo 里的标题）
  --provider <名字>  新开对话窗口用哪个 agent（默认 claude）。可填 paseo 支持的任意 ACP
                     provider，如 codex / cursor / gemini / cline / qwen-code……注意 provider
                     决定的是"paseo 拉起的那个 agent"，用的得是它的命令行工具：
                     cursor 走的是 cursor-agent CLI（不是 Cursor IDE 里的会话）。
  --model <名字>     新开对话窗口用哪个模型。不给的话自动从本机 Claude Code 配置里读
                     （项目/用户的 .claude/settings.json 的 model 或 env.ANTHROPIC_MODEL 等，
                     最后才看环境变量）；都读不到才让 paseo 自己决定。
                     为什么要管这个：paseo 自己决定时会用内置 manifest 挑一个 Claude 原生
                     名字（如 claude-opus-5-5），**不读 settings.json**。自建网关的环境下那个
                     名字网关可能不认，窗口就起不来（对方表现为"连不上"）。
  --no-model         完全不传模型，直接用 paseo 内置的默认值（排查对比用）
  --cwd <目录>       新开窗口的工作目录（默认用户主目录）
  --agent <ID>       不新开，直接用已有的 Paseo 窗口当对话窗口
  --home <目录>      Paseo home（多开/测试用，默认 ~/.paseo）
  --port <端口>      首次启动 daemon 的端口（默认 6767）
  --rotate           换新链接（危险操作）：重置本机身份（server-id + daemon-keypair.json），老配对链接
                     立即失效、所有对端换新名片、daemon 重启（正在跑的窗口会中断）。
                     口径：仅当用户明确说出唯一口令 "agent-penpal reset pair"（即
                     /agent-penpal reset pair）并二次确认后才可用
  --confirm          --rotate 必须同时带上（危险操作双开关，防误触；对话窗口 agentid 不变）
  --force            --rotate 时，连"自己就跑在本机 daemon 的窗口里"也强行执行（一般别用）
  --dry-run          只打印计划，不执行`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  // 危险操作闸门：--rotate 必须同时给 --confirm（防模型/人误触）。
  // 约定（见 SKILL.md）：只有用户明确说"换新链接"并二次确认后才允许这么调
  if (args.rotate && !args.confirm) {
    console.error("⚠ --rotate 是危险操作：老链接全部作废（所有对端要换新名片）、daemon 重启、正在跑的窗口中断。");
    console.error('  仅当用户明确说出唯一口令 "agent-penpal reset pair"（即 /agent-penpal reset pair）、并二次确认后，才加 --confirm 重跑：');
    console.error("  node setup.mjs --rotate --confirm");
    process.exitCode = 1;
    return;
  }

  // 1. paseo CLI 预检（定位 + 报错指引都在 lib-paseo.mjs：还会认桌面 App 自带的那份 CLI）
  const paseo = precheckPaseo();
  if (!paseo) {
    process.exitCode = 1;
    return;
  }
  console.log(`→ 环境检查通过：Node ${process.version}，paseo CLI ${paseo.version}`);
  if (Number(process.versions.node.split(".")[0]) < 21) {
    console.log("  （当前 Node 低于 18：建议升一下，20/22 LTS 都行）");
  }

  // 2. daemon 状态
  const st = paseoRun(["daemon", "status", "--json"], { kind: "home", home: args.home, timeout: 60000 });
  let daemonRunning = false;
  let daemonHome = null;
  let daemonListen = null;
  try {
    const j = JSON.parse(st.out);
    daemonRunning = j.localDaemon === "running";
    daemonHome = typeof j.home === "string" ? j.home : null;
    daemonListen = typeof j.listen === "string" ? j.listen : null;
  } catch {
    // 没跑或老版本不输出 JSON：按"没跑"处理，onboard 幂等，跑起来也不怕
  }

  // 调 paseo 时给哪种目标（见 lib-paseo.mjs 的 paseoEnv：PASEO_HOME 和 PASEO_HOST 只能给一个）：
  //   daemon 子命令（status/pair/onboard/stop）靠 PASEO_HOME 找 home——给 homeOpt
  //   客户端命令（ls/run/inspect）没有 --home 选项，用实测 listen 钉住本机 daemon——给 clientOpt
  const homeOpt = (extra = {}) => ({ kind: "home", home: args.home, ...extra });
  const clientOpt = (extra = {}) =>
    daemonListen ? { kind: "host", host: daemonListen, ...extra } : { kind: "home", home: args.home, ...extra };

  // --home 指到别的 daemon 时，环境里注入的 PASEO_AGENT_ID 属于原 daemon 的窗口，
  // 拿来当对话窗口会开出指向错 daemon 的名片——这时不认它（要复用就显式 --agent）
  const currentWindow = args.agent || (args.home ? null : process.env.PASEO_AGENT_ID) || null;

  if (args.dryRun) {
    const onboardArgs = ["onboard", "--voice", "disable", "--timeout", "240"];
    if (args.port) onboardArgs.push("--port", String(args.port));
    console.log("[dry-run] 不会真的执行。计划：");
    if (args.rotate) {
      console.log(
        `  0) --rotate 身份轮换：停 daemon → 备份并重置 ${args.home || daemonHome || path.join(HOME_DIR, ".paseo")} 下的 server-id / daemon-keypair.json → 老链接失效`,
      );
    }
    console.log(
      `  1) ${daemonRunning ? "（本地 daemon 已在跑，跳过启动）" : `paseo ${onboardArgs.join(" ")}`}`,
    );
    console.log("  2) paseo daemon pair --json   → 本机配对链接");
    console.log(
      currentWindow
        ? `  3) 对话窗口 = ${args.agent ? "--agent 指定" : "当前 Paseo agent 窗口"}：${currentWindow}（不新开）`
        : `  3) paseo run -d --json --provider ${args.provider}${args.model ? ` --model ${args.model}` : args.noModel ? "" : " --model <从本机 .claude/settings.json 读到的模型>"} --mode bypassPermissions --title 跨主机联动 --cwd ${args.cwd || HOME_DIR} "<启动语>"`,
    );
    console.log(
      args.home
        ? "  4) （--home 模式：跳过写全局坐标文件 ~/.paseo-self*）"
        : `  4) 写坐标文件：${FILE_SELF_LINK} / ${FILE_SELF_AGENT} / ${FILE_SELF}`,
    );
    return;
  }

  // 2a. 身份轮换（--rotate）：配对链接泄漏后换新链接——重置 server-id + daemon-keypair.json，老链接从此刻失效
  if (args.rotate) {
    const rotHome = args.home || daemonHome || path.join(HOME_DIR, ".paseo");
    // 从本机 daemon 的 agent 窗口里跑（PASEO_AGENT_ID 注入）且目标就是同一个 daemon → 重启会停掉自己会话，拦住
    const ambientHome = process.env.PASEO_HOME || path.join(HOME_DIR, ".paseo");
    const sameHome =
      path.resolve(rotHome).toLowerCase() === path.resolve(ambientHome).toLowerCase();
    if (process.env.PASEO_AGENT_ID && sameHome && !args.force) {
      console.error("⚠ 你现在就跑在这个 daemon 的 agent 窗口里——重启 daemon 会把你自己的会话一起停掉。");
      console.error("  换个普通终端跑；确认现在就要做，加 --force。");
      process.exitCode = 1;
      return;
    }
    if (daemonRunning) {
      console.log("→ 停 daemon（正在跑的窗口会中断）…");
      const stopRes = paseoRun(["daemon", "stop"], homeOpt({ timeout: 60000 }));
      if (stopRes.code !== 0) {
        console.error("停 daemon 失败：");
        console.error(stopRes.all || `（退出码 ${stopRes.code}）`);
        process.exitCode = 1;
        return;
      }
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const f of ["server-id", "daemon-keypair.json"]) {
      try {
        fs.renameSync(path.join(rotHome, f), path.join(rotHome, `${f}.bak-${ts}`));
        console.log(`→ 旧身份已备份：${f}.bak-${ts}`);
      } catch {
        /* 文件不存在（全新 home），跳过 */
      }
    }
    console.log("→ 老链接已失效；继续冷启动流程，生成新身份…");
    daemonRunning = false; // 下面重新 onboard 起 daemon
  }

  // 2b. 没跑就起来（onboard 幂等：已在跑会直接跳过）
  if (daemonRunning) {
    console.log("→ 本地 daemon 已在跑");
  } else {
    console.log("→ 启动本地 daemon（首次要几十秒，最长等 4 分钟）…");
    const onboardArgs = ["onboard", "--voice", "disable", "--timeout", "240"];
    if (args.port) onboardArgs.push("--port", String(args.port));
    const ob = paseoRun(onboardArgs, homeOpt({ timeout: 300000 }));
    if (ob.code !== 0) {
      console.error("启动 daemon 失败：");
      console.error(ob.all || `（退出码 ${ob.code}）`);
      process.exitCode = 1;
      return;
    }
    console.log("→ daemon 就绪");
    // 再读一次状态拿实际 listen（自定义端口时 config.json 里可能还是默认 6767，pid 文件里的才准）
    const st2 = paseoRun(["daemon", "status", "--json"], homeOpt({ timeout: 60000 }));
    try {
      daemonListen = JSON.parse(st2.out).listen ?? daemonListen;
    } catch {
      /* 拿不到就退化为默认解析（本机 ~/.paseo + 6767） */
    }
  }
  // 3. 本机配对链接
  let link = null;
  const pr = paseoRun(["daemon", "pair", "--json"], homeOpt({ timeout: 60000 }));
  try {
    const j = JSON.parse(pr.out);
    if (j.relayEnabled && j.url) link = j.url;
  } catch {
    // 老版本可能混着额外输出，退回正则
  }
  if (!link) link = (pr.all.match(/https:\/\/app\.paseo\.sh\/#offer=[A-Za-z0-9_=-]+/) || [])[0] || null;

  if (link) {
    console.log("→ 配对链接 OK（relay 已开）");
  } else {
    // 别一口咬定是 relay：`daemon pair` 失败的原因好几种，先看原始输出再下结论
    //（曾经这里无脑提示"relay 可能关着"，把 TARGET_AMBIGUOUS 这种环境变量冲突引到改 config 上白折腾）
    const configPath = path.join(args.home || daemonHome || path.join(HOME_DIR, ".paseo"), "config.json");
    let relayOn = null;
    try {
      relayOn = JSON.parse(pr.out).relayEnabled === true;
    } catch {
      /* 输出不是 JSON（老版本/混了警告行）——下面按"不知道"处理 */
    }
    console.warn("⚠ 配对链接没生成。paseo 的原始输出：");
    console.warn(pr.all ? `  ${pr.all.slice(0, 500)}` : "  （没有输出）");
    if (/TARGET_AMBIGUOUS/.test(pr.all)) {
      console.warn("  原因：PASEO_HOME 和 PASEO_HOST 环境变量同时存在，paseo 拒绝执行。");
      console.warn("  旧版脚本有这个 bug，升级后即可；想立刻绕过就先清掉其中一个再重跑。");
    } else if (pr.error) {
      console.warn(`  原因：paseo CLI 根本没跑起来（${pr.error.message}）——见上面的环境检查。`);
    } else if (relayOn === false) {
      console.warn(`  原因：relay 关着。在 ${configPath} 里设 "relayEnabled": true，然后 paseo daemon restart，再重跑本脚本。`);
    } else {
      console.warn("  上面是 paseo 的原话；relay 是开着的，问题在别处（可加 PASEO_DEBUG=1 看更多）。");
    }
    console.warn("  （不影响下面的对话窗口：本机仍能收消息、能回复，只是对方无法主动回找本机。）");
  }

  // 4. 对话窗口：显式指定 > 当前 Paseo agent 窗口 > 沿用已存的（重复跑不重复开窗）> 新开一个常驻窗口
  let agentId = null;
  let agentNote = "";
  let autoWindowTitle = null; // 对话窗口在 Paseo 里的标题（当名片 DESC 的自动值，默认名"跨主机联动"不算）
  if (args.agent) {
    agentId = args.agent;
    agentNote = "--agent 指定";
  } else if (process.env.PASEO_AGENT_ID && !args.home) {
    agentId = process.env.PASEO_AGENT_ID;
    agentNote = "当前 Paseo agent 窗口（PASEO_AGENT_ID 注入）";
  } else {
    // 先复用：~/.paseo-self-agent 存过对话窗口、且它还在本 daemon 上 → 沿用，不再新开（重复跑不乱开窗）
    let reused = false;
    if (!args.home) {
      const stored = readFileTrim(FILE_SELF_AGENT);
      if (stored) {
        const ls0 = paseoRun(["ls", "-a", "-g", "--json"], clientOpt({ timeout: 60000 }));
        try {
          const list0 = JSON.parse(ls0.out);
          const hit0 = Array.isArray(list0)
            ? list0.find((x) => x.id === stored || x.shortId === stored)
            : null;
          if (hit0) {
            agentId = stored;
            // 会话已经有模型就用它的（不去改）；顺手把模型名显示出来，方便对不上时一眼看到
            const m =
              typeof hit0.provider === "string" && hit0.provider.includes("/")
                ? hit0.provider.split("/").slice(1).join("/")
                : null;
            agentNote = `沿用已存的对话窗口（~/.paseo-self-agent，还在${m ? ` · 模型 ${m}` : ""}）`;
            autoWindowTitle = typeof hit0.name === "string" && hit0.name ? hit0.name : null;
            reused = true;
          }
        } catch {
          /* 输出解析不了就当没存过，走新开 */
        }
      }
    }
    if (!reused) {
      const cwd = args.cwd || HOME_DIR;

      // 决定模型：--model 显式 > 本机 cc 配置 > 不传（交给 paseo 内置默认值）。
      // 中间这条是关键：paseo 默认会挑一个 Claude 原生名字且不看 settings.json，
      // 自建网关环境下可能直接把窗口卡死，所以能读到本机配置就一定显式传过去。
      let modelArg = null;
      let modelNote = "";
      if (args.model) {
        modelArg = args.model;
        modelNote = "--model 指定";
      } else if (!args.noModel) {
        const hit = resolveClaudeModel(cwd);
        if (hit) {
          modelArg = hit.model;
          modelNote = hit.from;
        }
      }

      console.log(`→ 开常驻对话窗口（provider=${args.provider}，cwd=${cwd}）…`);
      if (modelArg) {
        console.log(`  模型：${modelArg}`);
        console.log(`       （来自 ${modelNote}）`);
      } else {
        console.log("  模型：不指定 —— 交给 paseo 内置默认值。");
        console.log("       它挑的是 Claude 原生名字且不读 settings.json，自建网关下可能不被认；");
        console.log("       窗口起来了却联系不上对方时，用 --model <名字> 手动给一个。");
      }

      // --mode bypassPermissions：对话窗口的职责就是执行对方请求（adb、查文件…），默认权限模式下第一个
      // 工具调用就卡审批、把整条对话拖到超时（实测踩到）。链接本来=daemon 全权，这里不新增暴露面。
      // 注意要用全名 bypassPermissions（inspect 的 AvailableModes 里的规范值，"bypass" 简写不保证认）
      const runArgs = [
        "run",
        "-d",
        "--json",
        "--provider",
        args.provider,
        "--mode",
        "bypassPermissions",
        "--title",
        "跨主机联动",
        "--cwd",
        cwd,
      ];
      if (modelArg) runArgs.push("--model", modelArg);
      runArgs.push(BOOTSTRAP_PROMPT);
      const r = paseoRun(runArgs, clientOpt({ timeout: 240000 }));
      const full = (r.all.match(/"agentId"\s*:\s*"([^"]+)"/) || [])[1] || null;
      if (!full) {
        console.error("开对话窗口失败（provider 的 agent CLI 装了吗？比如 --provider codex 需要先装 codex）；");
        console.error(`当前用的是 --provider ${args.provider}。换一个本机已经装好的试试，比如 --provider claude / codex；`);
        console.error("paseo 支持的 provider 不止这两个：cursor（需要 cursor-agent CLI）、gemini、cline、qwen-code 等都能填。");
        if (modelArg) console.error(`模型用的是 ${modelArg}（来自 ${modelNote}）——如果是自建网关，确认网关认这个名字。`);
        console.error(r.all || `（退出码 ${r.code}）`);
        process.exitCode = 1;
        return;
      }
      agentId = full;
      agentNote = `新开的常驻窗口（${args.provider}${modelArg ? ` · ${modelArg}` : ""}）`;
    }
  }

  // 当前会话当对话窗口时：拿一次 inspect——顺手取窗口标题（当名片简介）；权限模式不是 bypass 就提醒
  if (!args.agent && !args.home && process.env.PASEO_AGENT_ID) {
    const ins = paseoRun(["inspect", agentId, "--json"], clientOpt({ timeout: 30000 }));
    try {
      const info = JSON.parse(ins.out);
      if (typeof info.Name === "string" && info.Name) autoWindowTitle = info.Name;
      const mode = info.Mode ?? "";
      if (mode && !/bypass/i.test(mode)) {
        console.warn(
          `⚠ 当前窗口权限模式是 ${mode}——之后执行对方请求时可能卡权限审批；把本窗口切成 bypass 模式，或由对端 paseo permit allow 远程批准（见 SKILL.md 排查）`,
        );
      }
    } catch {
      /* inspect 拿不到就跳过 */
    }
  }

  // 名片简介（可选，≤200 字）——职责，**仓库级、首次生成后固定**：
  //   --desc 手动 > 已存简介文件（不动它）> 首次自动：读 cwd 的 README/CLAUDE.md 提取一句 > 对话窗口标题 > 省略
  let desc = args.desc ? String(args.desc).replace(/\s+/g, " ").trim().slice(0, 200) : null;
  const storedDesc = readFileTrim(FILE_SELF_DESC);
  if (!desc && storedDesc) desc = storedDesc;
  if (!desc) {
    desc = extractRepoBlurb(args.cwd || process.cwd());
    if (!desc && autoWindowTitle && autoWindowTitle !== "跨主机联动") {
      desc = autoWindowTitle.replace(/\s+/g, " ").trim().slice(0, 200);
    }
  }

  // 短ID 更好用（对方名片里写短ID，send/logs 都认）：拿全 ID 去 ls 里换一次
  try {
    const ls = paseoRun(["ls", "-a", "-g", "--json"], clientOpt({ timeout: 60000 }));
    const list = JSON.parse(ls.out);
    const hit = Array.isArray(list) ? list.find((x) => x.id === agentId) : null;
    if (hit && hit.shortId) agentId = hit.shortId;
  } catch {
    // 换不到就保留原样（全 ID 也能用）
  }

  // 5. 写坐标文件（ask.mjs 会读）。--home 指的非默认 home 不写全局坐标——否则会把主 daemon 的坐标覆盖掉
  const name = args.name || readFileTrim(FILE_SELF) || os.hostname();
  const wroteSelfFiles = !args.home;
  if (wroteSelfFiles) {
    fs.writeFileSync(FILE_SELF, `${name}\n`, "utf8");
    if (link) fs.writeFileSync(FILE_SELF_LINK, `${link}\n`, "utf8");
    fs.writeFileSync(FILE_SELF_AGENT, `${agentId}\n`, "utf8");
    // 简介文件：首次生成后就固定（之后跑 setup 不自动重造；想刷新：删掉它再跑，或 --desc 手动覆盖）
    if (desc) fs.writeFileSync(FILE_SELF_DESC, `${desc}\n`, "utf8");
  }

  // 6. 打印名片与下一步
  console.log("");
  console.log("✓ 完成。");
  console.log(`  本机名字：${name}`);
  console.log(`  对话窗口：${agentId}（${agentNote}）`);
  if (desc) console.log(`  一句话介绍：${desc}`);
  console.log(
    wroteSelfFiles
      ? `  坐标文件：${FILE_SELF_LINK} / ${FILE_SELF_AGENT} / ${FILE_SELF}`
      : "  （--home 模式：未写全局坐标文件 ~/.paseo-self*）",
  );
  console.log("");
  if (args.rotate) {
    console.log("⚠ 身份已轮换：老链接已失效，所有对端都要换新名片（对方名册里的旧条目作废）。");
  }
  if (link) {
    console.log("把下面这张名片发给对方 agent（对方存下就能主动找本机）：");
    console.log("");
    console.log("=== PENPAL CARD ===");
    console.log(`NAME=${name}`);
    if (desc) console.log(`DESC=${desc}`);
    console.log(`LINK=${link}`);
    console.log(`AGENT=${agentId}`);
    console.log("==================");
  } else {
    console.log("对方暂时无法主动回找本机（缺配对链接）；本机仍能收消息、能回复。");
  }
  console.log("");
  console.log(
    `本机主动找对方：node "${ASK_SCRIPT}" --host <对方LINK> --agent <对方AGENT> "问题…"（对方名片里有这两项）`,
  );
  console.log(
    `看收到的消息：paseo logs ${agentId} --tail 30（或 paseo attach ${agentId} 实时看；装了桌面 App 可直接看窗口）`,
  );
}

guardMain(main);
