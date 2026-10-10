#!/usr/bin/env node
/**
 * ask.mjs — 向对端机器的 Paseo 对话窗口发一条消息，等对方处理完，把答复抓回来。
 * 把"发送 → 等 → 拉答复"三步变成一条命令，供 agent 在对话里当函数调用。
 *
 * 用法:
 *   node ask.mjs <对方LINK> <对方AGENT> "问题……"   # 对方名片两行照抄（推荐）
 *   node ask.mjs "名片整块 + 问题……"                 # 名片整块（LINK=/AGENT=）粘进来也认
 *   node ask.mjs "多张名片 + 问题……"                 # ≥2 张名片 = 并行群发（每台一条独立流水线，最多 10 台）
 *   node ask.mjs --peer <名字> "问题……"             # 按名册名字发（收过/发过的名片自动入册）
 *   node ask.mjs "问题……"              # 没点名：坐标从 --host/--agent、环境变量或"最近一次"文件取
 *   node ask.mjs --file question.txt
 *   node ask.mjs --list                 # 看名册存了哪些远程；--remember "<名片>" 手动存一张
 *   node ask.mjs --dry-run "……"        # 只打印将执行什么，不真发
 *   node ask.mjs --no-card "……"        # 本条不附名片（默认：每条消息开头自动附，供对方回找）
 *   node ask.mjs --no-check "……"       # 跳过发送前的连接检查
 *   node ask.mjs --async "名片+问题……"  # 发完就走（尾附说明）；收答复默认 --replies 拉；对方装 skill 也可能主动发来
 *   node ask.mjs --replies <LINK> <AGENT>  # 只拉取对方窗口最新内容（不发送，兜底收答复）
 *
 * 发送前自动做环境预检（paseo CLI 在不在）和连接检查（paseo ls：连不上 / 对端窗口ID不存在
 * 都立即报错退出，不等 10 分钟超时）。
 *
 * 取值优先级:
 *   链接:   --peer <名字：先本机名册，再 GUI 别名 peers.mjs> > --host <链接> > 环境变量 PASEO_PEER > 文件 ~/.paseo-peer（最近一次）
 *   窗口ID: --agent <短ID/全ID> > 名册命中带出的 > 环境变量 PASEO_PEER_AGENT > 文件 ~/.paseo-peer-agent
 *   来源名: --from <名字> > 环境变量 PASEO_SELF > 文件 ~/.paseo-self（设了就自动加【来自X】前缀）
 *
 * 文件兜底给环境变量不好设的机器用（如 Linux 服务器：agent 的 shell 非交互、不读 .bashrc）。
 *   名片:   默认每条消息开头自动附（AGENT 取 --self-agent > PASEO_SELF_AGENT > PASEO_AGENT_ID（当前窗口）
 *           > 文件 ~/.paseo-self-agent（setup.mjs 冷启动写的常驻窗口）；LINK 取 PASEO_SELF_LINK >
 *           文件 ~/.paseo-self-link > 自动生成）；--no-card 关闭
 *
 * 注意：会阻塞等对方处理（最长 10 分钟）；对方 timeout 时自动再 wait 一轮。
 * 退出码: 0 拿到答复（含超时后取的进度）; 1 出错。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { guardMain, paseoRun, precheckPaseo } from "./lib-paseo.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PEERS_SCRIPT = path.join(SCRIPTS_DIR, "peers.mjs");

// 坐标文件兜底：环境变量没设时读这几个文件（Linux 机器上尤其有用——agent 的 shell 非交互、不读 .bashrc；
// ~/.paseo-self-* 由 setup.mjs 冷启动写好）
const HOME_DIR = os.homedir();
const FILE_PEER = path.join(HOME_DIR, ".paseo-peer");
const FILE_PEER_AGENT = path.join(HOME_DIR, ".paseo-peer-agent");
const FILE_SELF = path.join(HOME_DIR, ".paseo-self");
const FILE_SELF_LINK = path.join(HOME_DIR, ".paseo-self-link");
const FILE_SELF_AGENT = path.join(HOME_DIR, ".paseo-self-agent");
const FILE_SELF_DESC = path.join(HOME_DIR, ".paseo-self-desc");
function readFileTrim(p) {
  try {
    return fs.readFileSync(p, "utf8").trim() || null;
  } catch {
    return null;
  }
}

// 名册：**以 pair+agentid（link|agent）为主键**——身份唯一、不重复；name/desc 是
// "可被最新覆盖"的标签；lastUsedAt 驱动 --list 的最近使用排序（LRU 风格）
// （窗口标题字段已移除 2026-10-10：DESC 已覆盖"这台是谁"的信息，标题只会是噪音）
const FILE_PEERS = path.join(HOME_DIR, ".paseo-peers.json");
function peerKey(link, agent) {
  return `${link}|${agent}`;
}
function readRegistry() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE_PEERS, "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const reg = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object" || !v.link || !v.agent) continue;
    // 兼容旧格式（按名字作键、值里没 name）：自动迁移成按 link|agent 作键
    reg[peerKey(v.link, v.agent)] = {
      name: (typeof v.name === "string" && v.name) || (k.includes("|") ? null : k),
      link: v.link,
      agent: v.agent,
      desc: v.desc || null,
      lastUsedAt: v.lastUsedAt || 0,
    };
  }
  return reg;
}
function savePeer(name, link, agent, desc = null) {
  if (!name) return false;
  const reg = readRegistry();
  const key = peerKey(link, agent);
  const prev = reg[key] || {};
  reg[key] = {
    name: name || prev.name || null, // 改名：同一身份直接覆盖名字，不产生第二条
    link,
    agent,
    desc: desc || prev.desc || null,
    lastUsedAt: Date.now(),
  };
  try {
    fs.writeFileSync(FILE_PEERS, JSON.stringify(reg, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
function peerAge(ts) {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(ts).toISOString().slice(0, 10);
}

// 记住对方坐标：名册（按名字，可多台）+"最近一次"兜底文件；返回名册名提示串（没名字则为空）
function rememberPeer(args, link, agent) {
  const name = args.cardName || (args.peer ? String(args.peer).trim() : null);
  const named = name ? savePeer(name, link, agent, args.cardDesc || null) : false;
  try {
    if (readFileTrim(FILE_PEER) !== link) fs.writeFileSync(FILE_PEER, `${link}\n`, "utf8");
    if (readFileTrim(FILE_PEER_AGENT) !== agent) fs.writeFileSync(FILE_PEER_AGENT, `${agent}\n`, "utf8");
  } catch {
    /* 写不进去不影响本次对话 */
  }
  return named ? `（名册名 "${name}"）` : "";
}

// 通用子进程执行器。**只用于跑非 paseo 的命令**（目前只有 peers.mjs 那一处）；
// 所有 paseo 调用一律走 lib-paseo.mjs 的 paseoRun —— 它负责定位 CLI 和拼对 env
// （PASEO_HOME / PASEO_HOST 不能同时给，否则 CLI 报 TARGET_AMBIGUOUS 整个罢工）。
function run(cmd, args, { env = {}, shell = false, timeout = 60000 } = {}) {
  // shell=true（Windows 跑 paseo.cmd 需要）时拼成单条命令串（带空格的参数手工加引号，也避免 DEP0190）；
  // shell=false 走 argv 数组，不做引号处理
  const [c, ...rest] = shell
    ? [[cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, "")}"` : a)).join(" ")]
    : [cmd, ...args];
  const res = spawnSync(c, rest, {
    encoding: "utf8",
    shell,
    env: { ...process.env, ...env },
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "").trim() };
}

// 位置参数识别：对方名片两行照抄时自动当坐标用
const OFFER_LINK_RE = /^https?:\/\/\S*(?:paseo\.sh|#offer=)/i;
const AGENT_ID_RE = /^(?:[0-9a-f]{6,8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// 名片整块（=== PASEO CARD === / === 名片 === 包边可有可无）直接粘进来也认
const CARD_LINK_RE = /LINK=(https?:\/\/\S+)/i;
const CARD_AGENT_RE = /AGENT=([0-9a-zA-Z_-]{4,})/;
const CARD_NAME_RE = /NAME=(.+)/i;
const CARD_DESC_RE = /DESC=(.+)/i;

function parseArgs(argv) {
  const o = { agent: null, peer: null, host: null, from: null, file: null, tail: 50, dryRun: false, noCard: false, selfAgent: null, selfDesc: null, noCheck: false, noWait: false, asyncMode: false, replies: false, list: false, remember: null, cardName: null, cardDesc: null, help: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent") o.agent = argv[++i];
    else if (a === "--peer") o.peer = argv[++i];
    else if (a === "--host") o.host = argv[++i];
    else if (a === "--from") o.from = argv[++i];
    else if (a === "--file") o.file = argv[++i];
    else if (a === "--tail") o.tail = Math.min(500, Math.max(1, Number(argv[++i]) || 50));
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--no-card") o.noCard = true;
    else if (a === "--no-check") o.noCheck = true;
    else if (a === "--no-wait") o.noWait = true;
    else if (a === "--async") o.asyncMode = true;
    else if (a === "--replies") o.replies = true;
    else if (a === "--self-agent") o.selfAgent = argv[++i];
    else if (a === "--self-desc") o.selfDesc = argv[++i];
    else if (a === "--list" || a === "--ls") o.list = true;
    else if (a === "--remember") o.remember = argv[++i];
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("-")) {
      console.error(`未知参数: ${a}（--help 看用法）`);
      process.exit(2);
    } else pos.push(a);
  }
  // 名片整块粘进来也认：从文本里扒 LINK=/AGENT=/NAME= 当坐标，并把名片行从消息里清掉
  const pos2 = pos.map((t) => {
    const lm = t.match(CARD_LINK_RE);
    const am = t.match(CARD_AGENT_RE);
    if (lm && !o.host) o.host = lm[1].trim();
    if (am && !o.agent) o.agent = am[1].trim();
    if (!lm && !am) return t;
    if (!o.cardName) {
      const nm = t.match(CARD_NAME_RE);
      if (nm) o.cardName = nm[1].trim();
    }
    if (!o.cardDesc) {
      const dm = t.match(CARD_DESC_RE);
      if (dm) o.cardDesc = dm[1].trim();
    }
    return t
      .split("\n")
      .filter((ln) => !/^\s*(LINK=|AGENT=|NAME=|DESC=|SKILL=|={3,})/.test(ln))
      .join("\n")
      .trim();
  });
  // 开头像配对链接的当 --host；紧跟着像窗口ID的（且不是孤零零一条消息）当 --agent
  const rest = pos2.filter((t) => t.length > 0);
  let linkEaten = false;
  if (rest.length && !o.host && OFFER_LINK_RE.test(rest[0])) {
    o.host = rest.shift();
    linkEaten = true;
  }
  if (rest.length && !o.agent && AGENT_ID_RE.test(rest[0]) && (linkEaten || rest.length >= 2)) {
    o.agent = rest.shift();
  }
  o.message = rest.join(" ");

  // 群发：收集位置参数里出现的所有名片（同一段文本可含多张）——≥2 张时走并行群发
  const targets = [];
  for (const t of pos) {
    const links = [...t.matchAll(/LINK=(https?:\/\/\S+)/gi)].map((m) => m[1].trim());
    const agents = [...t.matchAll(/AGENT=([0-9a-zA-Z_-]{4,})/g)].map((m) => m[1].trim());
    const names = [...t.matchAll(/NAME=(.+)/g)].map((m) => m[1].trim());
    const descs = [...t.matchAll(/DESC=(.+)/g)].map((m) => m[1].trim());
    for (let i = 0; i < Math.min(links.length, agents.length); i++) {
      targets.push({ link: links[i], agent: agents[i], name: names[i] || agents[i], desc: descs[i] || null });
    }
  }
  const seenKeys = new Set();
  o.targets = targets.filter((t) => {
    const k = `${t.link}|${t.agent}`;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });
  return o;
}

const HELP = `用法: node ask.mjs <对方LINK> <对方AGENT> "问题……"    # 对方名片两行照抄（推荐）
      node ask.mjs "名片整块 + 问题……"       # 名片整块（LINK=/AGENT=）粘进来也认
      node ask.mjs "多张名片 + 问题……"       # ≥2 张名片 = 并行群发（各等各的，最多 10 台；输出按名字分组）
      node ask.mjs --peer <名字> "问题……"   # 按名册名字发（收过/发过的名片自动入册）
      node ask.mjs "问题……"                    # 没点名：坐标取 --host/--agent、环境变量或"最近一次"文件
      node ask.mjs --list                    # 看名册（最近使用在前，带对端窗口标题；--remember "<名片>" 手动存一张）
发送前自动做环境预检（paseo CLI 在不在）和连接检查（连不上 / 窗口ID不存在就立刻报错，不干等）。
  --host <链接>    对端配对链接（也认第一个位置参数）
  --agent <ID>     对端对话窗口短ID（也认第二个位置参数）
  --peer <名字>    按名字查坐标：先查本机名册（收过的名片），再退 GUI 别名（peers.mjs）
  --from <名字>    来源名，自动加【来自X】前缀（或用环境变量 PASEO_SELF）
  --file <文件>    消息内容从文件读（长文本用）
  --tail <n>       拉答复时取最后 n 行（默认 50；回复文本后面可能跟"思考块"，留点余量）
  --no-card        本条不附名片（默认每条消息开头自动附：本机 NAME+LINK+AGENT）
  --self-agent <ID> 名片里的对话窗口ID（默认取 PASEO_SELF_AGENT > 当前窗口 PASEO_AGENT_ID > 文件 ~/.paseo-self-agent）
  --self-desc <文字> 本条消息名片里的一句话介绍（覆盖 ~/.paseo-self-desc；可临时带"当前在处理…"）
  --no-check       跳过发送前的连接检查
  --async          发完就走（不等答复）；消息尾附一句【说明】（我会来拉取；对方装 skill 也可主动发，可选）；
                   收答复默认用 --replies 拉
  --no-wait        发完就走（不等答复）的通用形态，同 --async 但不附任何东西
  --replies        只拉取不发送（对方窗口最新 N 行）——收异步/长任务答复用
  --dry-run        只打印要执行什么，不发送
坐标兜底：名册 ~/.paseo-peers.json（--peer <名字> 查）；"最近一次"文件 ~/.paseo-peer（链接）/ ~/.paseo-peer-agent（窗口ID）；名字 ~/.paseo-self；名片坐标读 ~/.paseo-self-link / ~/.paseo-self-agent（setup.mjs 冷启动生成）`;

function resolveLink(args) {
  if (args.peer) {
    // 先查本机名册（按名片里的名字匹配；条目身份键是 link|agent），再退回 GUI 别名（peers.mjs）
    const values = Object.values(readRegistry());
    const want = String(args.peer).trim().toLowerCase();
    // 先精确匹配名字；没有再模糊；**任何一种匹配到多台都报错**（同一仓库多会话可能同名，不默默取第一个）
    const exact = values.filter((v) => (v.name || "").trim().toLowerCase() === want);
    const matches = exact.length
      ? exact
      : values.filter((v) => (v.name || "").toLowerCase().includes(want));
    if (matches.length > 1) {
      return {
        error: `名册里 "${args.peer}" 匹配到多台：${matches.map((v) => `${v.name}(${v.agent})`).join("、")}——用 --agent <窗口ID> 指定，或给对方各窗口起不同名字。`,
      };
    }
    const hit = matches[0] || null;
    if (hit && hit.link && hit.agent) return { link: hit.link, agent: hit.agent, source: `名册 "${args.peer}"` };
    const r = run(process.execPath, [PEERS_SCRIPT, args.peer], { timeout: 30000 });
    if (r.code !== 0) return { error: `按名字 "${args.peer}" 查坐标失败（名册里没有，GUI 别名也没有）：\n${r.out}` };
    return { link: r.out.split("\n")[0].trim(), source: `GUI 别名 ${args.peer}` };
  }
  if (args.host) return { link: args.host, source: "--host" };
  if (process.env.PASEO_PEER) return { link: process.env.PASEO_PEER, source: "环境变量 PASEO_PEER" };
  const f = readFileTrim(FILE_PEER);
  if (f) return { link: f, source: `文件 ${FILE_PEER}（最近一次）` };
  return { error: "没给对端链接：用 --peer <名字> 或 --host <链接>（或直接贴名片），或设环境变量 PASEO_PEER（也可写入 ~/.paseo-peer）。" };
}

// 群发：每张名片 = 一条独立的「发送→等→拉」流水线，并行跑、各等各的（不是轮询 N 个日志）。
// 实现上直接把本脚本按单张名片再拉起来（子进程），复用单发现有的 连接检查/发送/拉答复/入册 全套逻辑。
async function fanOut(args, targets, message) {
  const self = fileURLToPath(import.meta.url);
  const cardOf = (t) => `=== PASEO CARD ===\nNAME=${t.name}\n${t.desc ? `DESC=${t.desc}\n` : ""}LINK=${t.link}\nAGENT=${t.agent}\n==================`;
  const extra = [];
  if (args.from) extra.push("--from", args.from);
  if (args.selfAgent) extra.push("--self-agent", args.selfAgent);
  if (args.noCheck) extra.push("--no-check");
  if (args.noCard) extra.push("--no-card");
  if (args.asyncMode) extra.push("--async");
  if (args.noWait) extra.push("--no-wait");
  if (args.dryRun) extra.push("--dry-run");
  if (args.tail !== 30) extra.push("--tail", String(args.tail));

  console.log(`→ 群发：${targets.length} 个对端并行「发送→等→拉答复」（总时长 = 最慢那台）…`);
  const results = await Promise.all(
    targets.map(
      (t) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, [self, cardOf(t), ...extra, message], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          let out = "";
          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (out += d));
          child.on("close", (code) => resolve({ t, code, out }));
          child.on("error", (err) => resolve({ t, code: 1, out: `子进程启动失败：${err.message}` }));
        }),
    ),
  );

  let failed = 0;
  for (const r of results) {
    if (r.code !== 0) failed += 1;
    console.log(`\n────────── 【${r.t.name}】${r.code === 0 ? "" : "（失败）"} ──────────`);
    console.log(r.out.trim() || "(无输出)");
  }
  console.log(`\n────────── 群发结束：${results.length - failed}/${results.length} 成功 ──────────`);
  if (failed > 0) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  // --list / --remember 只动本地文件，不需要 paseo 在
  if (args.list) {
    const entries = Object.values(readRegistry()).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
    if (entries.length === 0) {
      console.log(`名册是空的（${FILE_PEERS}）。收到/发出带名片的远程消息后会自动入册；也可 ask.mjs --remember "<名片>" 手动存。`);
    } else {
      console.log(`已记住 ${entries.length} 台远程（最近使用在前；发送用 --peer <名字>，链接不在终端显示）：`);
      for (const v of entries) {
        console.log(`  ${v.name || v.agent}  ${v.agent}  ${peerAge(v.lastUsedAt)}`);
        if (v.desc) console.log(`    ${String(v.desc).slice(0, 140)}`);
      }
      if (entries.length === 1) console.log("只有一台——没点名时默认就是它。");
    }
    return;
  }
  if (args.remember) {
    const lm = args.remember.match(CARD_LINK_RE);
    const am = args.remember.match(CARD_AGENT_RE);
    if (!lm || !am) {
      console.error("名片里没扒到 LINK=/AGENT=，检查一下（--remember 后要带完整名片文本）。");
      process.exitCode = 1;
      return;
    }
    const nm = args.remember.match(CARD_NAME_RE);
    const name = (nm ? nm[1] : am[1]).trim();
    const dm = args.remember.match(CARD_DESC_RE);
    const ok = savePeer(name, lm[1].trim(), am[1].trim(), dm ? dm[1].trim() : null);
    if (ok) console.log(`→ 已记住 ${name}（窗口 ${am[1].trim()}）。以后：--peer ${name} "问题…"；--list 看全部。`);
    else {
      console.error("写名册失败（主目录不可写？）");
      process.exitCode = 1;
    }
    return;
  }

  // 环境预检：ask.mjs 的一切动作（查链接、发送、拉答复）都靠 paseo CLI
  if (Number(process.versions.node.split(".")[0]) < 21) {
    console.log(`提示：当前 Node ${process.version}，建议 21+（本脚本兼容更低版本，配套工具需要）`);
  }
  const paseo = precheckPaseo();
  if (!paseo) {
    process.exitCode = 1;
    return;
  }
  console.log(`→ 环境 OK（Node ${process.version}，paseo ${paseo.version}）`);

  const from = args.from || process.env.PASEO_SELF || readFileTrim(FILE_SELF) || null;
  let message = args.message;
  if (args.file) message = fs.readFileSync(args.file, "utf8").trim();
  if (!message && !args.replies) {
    // 只发名片 = 连接：补一条默认握手语（约定见 SKILL.md），别干等着失败
    message = "连接成功，请回复确认。（Connected. Please confirm.）";
    console.log(`→ 没带消息，发默认握手语：${message}`);
  }

  // 群发：贴了 ≥2 张名片 → 并行扇出（每台一条独立的"发送→等→拉"流水线，互不阻塞）
  if (args.targets.length >= 2 && !args.replies) {
    if (args.targets.length > 10) {
      console.error(`一次最多群发 10 台（当前收集到 ${args.targets.length} 张名片）。`);
      process.exitCode = 1;
      return;
    }
    void fanOut(args, args.targets, message);
    return;
  }

  // 名册命中会连窗口ID一起带出来，所以先解析链接、再定 agent
  const { link, source, error, agent: linkAgent } = resolveLink(args);
  if (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const agent = args.agent || linkAgent || process.env.PASEO_PEER_AGENT || readFileTrim(FILE_PEER_AGENT) || null;
  if (!agent) {
    console.error("没给对端窗口ID：用 --agent <ID>，或设环境变量 PASEO_PEER_AGENT（也可写入 ~/.paseo-peer-agent）。对方对话窗口短ID 用 paseo ls 查。");
    process.exitCode = 1;
    return;
  }

  // --replies：只拉取不发送（对方窗口最新 N 行）——收异步/长任务答复用
  if (args.replies) {
    console.log(`→ 拉取窗口 ${agent} 最新内容（最后 ${args.tail} 行，不发送）…`);
    const lg = paseoRun(["logs", agent, "--tail", String(args.tail)], {
      kind: "host",
      host: link,
      timeout: 120000,
    });
    console.log("========== 最新内容 ==========");
    console.log(lg.out || "(没有内容)");
    console.log("========== 结束 ==========");
    return;
  }

  // 名片：默认每条消息开头附（对方据此知道怎么回找本机）；--no-card 单条关闭
  // 不做环境变量开关：新会话/新窗口的环境继承自 daemon 进程，设置时机不同步，行为会飘——模式显式写在调用上
  let card = "";
  if (!args.noCard) {
    // 名片收件窗口：显式指定 > PASEO_SELF_AGENT > 本窗口（Paseo agent 运行时会注入 PASEO_AGENT_ID）> setup.mjs 写的文件
    const selfAgent =
      args.selfAgent ||
      process.env.PASEO_SELF_AGENT ||
      process.env.PASEO_AGENT_ID ||
      readFileTrim(FILE_SELF_AGENT) ||
      null;
    if (!selfAgent) {
      console.log("提示：拿不到本机对话窗口ID（不在 Paseo agent 窗口里跑、没设 PASEO_SELF_AGENT、也没有 ~/.paseo-self-agent——先跑 setup.mjs 冷启动可自动配好），本条未附名片。");
    } else {
      let selfLink = process.env.PASEO_SELF_LINK || readFileTrim(FILE_SELF_LINK) || null;
      if (!selfLink) {
        // 生成自己机器的配对链接：跟随当前环境指向的本地 daemon（PC 上 PASEO_SELF_HOME 已指好）。
        // daemon 子命令走 kind="home"——只留 PASEO_HOME、清掉 PASEO_HOST，否则两个都在 CLI 会报
        // TARGET_AMBIGUOUS（而且环境里那个 PASEO_HOST 指的是对端，本来就该清掉）。
        const p = paseoRun(["daemon", "pair", "--json"], {
          kind: "home",
          home: process.env.PASEO_SELF_HOME || null,
          timeout: 60000,
        });
        selfLink = (p.out.match(/https:\/\/app\.paseo\.sh\/#offer=[A-Za-z0-9_=-]+/) || [])[0] || null;
      }
      if (selfLink) {
        // DESC 来源：--self-desc 单条覆盖（带"当前在处理…"这类临时信息）> ~/.paseo-self-desc（职责，setup 写的）
        const selfDesc = args.selfDesc ? String(args.selfDesc).replace(/\s+/g, " ").trim().slice(0, 200) : readFileTrim(FILE_SELF_DESC);
        card = `=== PASEO CARD ===\n${from ? `NAME=${from}\n` : ""}${selfDesc ? `DESC=${selfDesc}\n` : ""}LINK=${selfLink}\nAGENT=${selfAgent}\n==================\n`;
      } else {
        console.log("提示：本机链接生成失败（可设 PASEO_SELF_LINK / PASEO_SELF_HOME，或先跑 setup.mjs），本条未附名片。");
      }
    }
  }

  const fullMessage = (from ? `【来自${from}】\n` : "") + card + message;

  // 异步模式：消息尾附一句【说明】——① 我们会来拉取（答复正常放窗口即可）② 对方装了 skill 也可主动发我们（可选）
  const ASYNC_NOTE =
    "\n\n【说明】处理完在本窗口正常回复即可，我会自己来拉取；装了 agent-penpal skill 的话，也可以用上面的名片主动给我发消息（可选）。";
  const toSend = args.asyncMode && card ? fullMessage + ASYNC_NOTE : fullMessage;

  if (args.dryRun) {
    console.log("[dry-run] 不会真的发送。将执行：");
    console.log(`  0) 连接检查：paseo ls -a -g --json（找对端窗口 ${agent}）${args.noCheck ? "——已用 --no-check 跳过" : ""}`);
    console.log(
      `  1) paseo send ${agent}${args.asyncMode || args.noWait ? " --no-wait" : ""} --prompt-file <临时文件>   （链接来源：${source}，${link.length} 字符）`,
    );
    if (args.asyncMode || args.noWait) {
      console.log("  2) 不等待——之后用 ask.mjs --replies 拉对方窗口最新内容");
    } else {
      console.log(`  2) 若 timeout：paseo wait ${agent} --timeout 600`);
      console.log(`  3) paseo logs ${agent} --tail ${args.tail}`);
    }
    console.log(`消息预览：${toSend.slice(0, 400)}${toSend.length > 400 ? "…" : ""}`);
    return;
  }

  // 连接检查：先 ls 一把——链路不通 / 窗口ID写错，几秒内就能报出来（不然 send 要等 10 分钟超时才现形）
  if (!args.noCheck) {
    console.log(`→ 连接检查（对端 ${agent}）…`);
    const pre = paseoRun(["ls", "-a", "-g", "--json"], {
      kind: "host",
      host: link,
      timeout: 90 * 1000,
    });
    let list = null;
    try {
      list = JSON.parse(pre.out);
    } catch {
      const start = pre.out.indexOf("["); // 输出里可能混了警告行，从第一个 [ 起再试
      if (start >= 0) {
        try {
          list = JSON.parse(pre.out.slice(start));
        } catch {
          /* 下面按连接失败处理 */
        }
      }
    }
    if (!Array.isArray(list)) {
      console.error("连不上对端。可能：对方 daemon 没在跑 / 链接抄错或失效 / 网络或 relay 问题。");
      console.error(pre.out ? `（原始输出：${pre.out.slice(0, 300)}）` : `（无输出，退出码 ${pre.code}）`);
      // 这两个错误的提示语本身有误导性，单独点破，别让人照着去改 relay/网络白折腾
      if (/TARGET_AMBIGUOUS/.test(pre.out)) {
        console.error("↑ 这是环境变量冲突（PASEO_HOME 和 PASEO_HOST 同时存在），不是网络问题——");
        console.error("  升级/重装本脚本可修（旧版的 paseoEnv 没把 PASEO_HOME 清干净）。");
      } else if (pre.error) {
        console.error(`↑ 这是本机问题：paseo CLI 没跑起来（${pre.error.message}）。`);
      }
      console.error("确认没问题的话，可加 --no-check 跳过检查直接发。");
      process.exitCode = 1;
      return;
    }
    const want = String(agent).toLowerCase();
    const hit = list.find(
      (a) =>
        String(a.id).toLowerCase().startsWith(want) ||
        String(a.shortId ?? "").toLowerCase() === want ||
        String(a.name ?? "") === agent,
    );
    if (!hit) {
      console.error(`连接没问题，但对端没有窗口 "${agent}"（现在发过去也会超时），核对：`);
      if (list.length === 0) {
        console.error("  对端一个窗口都没有——对方还没跑 setup.mjs 开对话窗口？");
      } else {
        for (const a of list.slice(0, 15)) console.error(`  ${a.shortId}  ${a.name ?? ""}（${a.status ?? ""}）`);
        if (list.length > 15) console.error(`  ……（共 ${list.length} 个窗口）`);
      }
      console.error("AGENT 抄错就照对方名片重对；对方重跑 setup.mjs 会出新名片。");
      process.exitCode = 1;
      return;
    }
    console.log(`→ 已连上：${hit.name ?? ""}（${hit.shortId}，${hit.status ?? "?"}）`);
  }

  const fireAndForget = args.asyncMode || args.noWait;
  console.log(
    fireAndForget
      ? `→ 发送给窗口 ${agent}（链接来源：${source}，${link.length} 字符），发完就走…`
      : `→ 发送给窗口 ${agent}（链接来源：${source}，${link.length} 字符），等对方处理…`,
  );
  const tmp = path.join(os.tmpdir(), `paseo-ask-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(tmp, toSend, "utf8");
  let send;
  try {
    const sendArgs = ["send", agent, "--prompt-file", tmp];
    if (fireAndForget) sendArgs.splice(2, 0, "--no-wait");
    send = paseoRun(sendArgs, {
      kind: "host",
      host: link,
      timeout: fireAndForget ? 120000 : 12 * 60 * 1000,
    });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 临时文件清理失败无所谓 */
    }
  }

  if (fireAndForget) {
    if (send.code !== 0) {
      console.error("send 失败：");
      console.error(send.out || `(退出码 ${send.code})`);
      process.exitCode = 1;
      return;
    }
    console.log("→ 已发出（不等待对方处理）。");
    console.log(`→ 已记住对方坐标${rememberPeer(args, link, agent)}`);
    console.log("  收答复（默认拉取）：node ask.mjs --replies <对方LINK> <对方AGENT>");
    if (args.asyncMode && card) console.log("  （对方装了 skill 也可能主动发过来 → 会作为消息进你窗口，可选）");
    return;
  }

  const m = send.out.match(/\b(completed|timeout|permission|error)\b/i);
  const status = m ? m[1].toLowerCase() : null;
  if (!status) {
    console.error("send 结果里没识别到状态，原文如下：");
    console.error(send.out || `(无输出，退出码 ${send.code})`);
    process.exitCode = 1;
    return;
  }
  console.log(`→ send 状态: ${status}`);

  // 记住对方坐标：名册 + "最近一次"兜底（没点名的"问远程"用它）
  if (status !== "error") {
    console.log(`→ 已记住对方坐标${rememberPeer(args, link, agent)}，最近一次：${FILE_PEER} / ${FILE_PEER_AGENT}`);
  }

  if (status === "permission") {
    console.log("⚠ 对方在等权限审批，远程批准：");
    console.log("  paseo permit ls --host <链接>");
    console.log(`  paseo permit allow ${agent} --all --host <链接>`);
  }
  if (status === "timeout") {
    console.log("⏳ 10 分钟没处理完，自动再等一轮（wait 600s）…");
    const w = paseoRun(["wait", agent, "--timeout", "600"], {
      kind: "host",
      host: link,
      timeout: 11 * 60 * 1000,
    });
    console.log(w.out || "(wait 无输出)");
  }

  console.log(`\n→ 拉取答复（最后 ${args.tail} 行，末尾最新）：`);
  const logs = paseoRun(["logs", agent, "--tail", String(args.tail)], {
    kind: "host",
    host: link,
    timeout: 120000,
  });
  console.log("========== 答复开始 ==========");
  console.log(logs.out || "(没有内容)");
  console.log("========== 答复结束 ==========");

  if (status === "error") {
    console.error("对方处理时报错（细节见上面日志）。");
    process.exitCode = 1;
  }
}

guardMain(main);
