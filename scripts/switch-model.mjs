#!/usr/bin/env node
/**
 * switch-model.mjs — 给一个**已经建好的**对话窗口换模型，不动 LINK、不动 AGENT。
 *
 * 为什么不能简单改文件：paseo daemon 的权威状态在**内存**里，磁盘只是它写出去的副本。
 * 实测三条死路：直接改文件+reload（被覆盖）、stop+改文件+reload（被覆盖）、
 * 停 daemon+只改 agents/*.json+起（启动时不读它）。
 *
 * 唯一可行的做法（已端到端验证）：
 *   1. 停 daemon（daemon 停着时才不会被回写）
 *   2. 改齐 5 处 model 字段
 *   3. 起 daemon（它从 creations/ 的 snapshot 恢复）
 * agent id 全程不变 → 名片（LINK+AGENT）不用重出，对方也不用重新配对。
 *
 * ⚠️ 这是改 paseo 的内部状态文件，**跨版本可能变 schema**。所以全程带：
 *    改前备份 → 改后校验 → 没生效自动回滚。校验失败会告诉你，不会留下半改状态。
 *
 * 用法:
 *   node switch-model.mjs <窗口ID|前缀> <新模型名>
 *   node switch-model.mjs <窗口ID> <模型名> --dry-run      # 只看计划
 *   node switch-model.mjs <窗口ID> <模型名> --home <PASEO_HOME>
 *   node switch-model.mjs <窗口ID> <模型名> --force        # 目标就是自己所在窗口时
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { guardMain, paseoRun } from "./lib-paseo.mjs";

const HOME_DIR = os.homedir();
const SELF = fileURLToPath(import.meta.url);
const BG_FLAG = "--__bg"; // 内部用：表示"我已经脱钩过了"，不要再脱一次

/**
 * 我们是不是跑在 paseo daemon 的进程树底下？
 * 是的话就危险：`paseo daemon stop` 会把它自己的子进程**一起杀掉**（实测：
 * agent 的 claude 进程就是 daemon 的子进程），脚本会在停 daemon 那一刻被带走，
 * 永远走不到"起 daemon"—— 结果是把那台机器留在失联状态。
 */
function paseoAncestor() {
  if (process.env.PASEO_AGENT_ID) return "PASEO_AGENT_ID 环境变量";
  if (process.platform === "win32") return null; // Windows 没有 ps，只能靠上面的环境变量
  let pid = process.ppid;
  for (let i = 0; i < 10 && pid && pid !== 1; i++) {
    const comm = (spawnSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).stdout || "").trim();
    if (/Paseo/i.test(comm)) return `祖先进程「${comm}」(pid ${pid})`;
    const ppid = (spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).stdout || "").trim();
    pid = Number(ppid) || 0;
  }
  return null;
}

const HELP = `用法: node switch-model.mjs <窗口ID|前缀> <新模型名> [选项]
  给已建好的对话窗口换模型（不动 LINK / AGENT，不用重新配对）。
  执行期间会停再起一次 daemon：正在跑的窗口会中断，但 ID 不变，对方重发即可续上。

  --home <目录>   Paseo home（默认取 $PASEO_HOME，再默认 ~/.paseo）
  --dry-run       只打印计划，不改任何东西、不重启 daemon
  --force         目标窗口就是你所在的窗口时也强行执行（会把你自己的会话一起停掉）
  --keep-daemon   只改文件、不碰 daemon（daemon 之后得手动重启才会生效）
  -h, --help      看这个

先看有哪些窗口：paseo ls -a -g --json
先看模型名该填什么：paseo provider models claude`;

function parseArgs(argv) {
  const o = { id: null, model: null, home: null, dryRun: false, force: false, keepDaemon: false, help: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home") o.home = argv[++i];
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--force") o.force = true;
    else if (a === "--keep-daemon") o.keepDaemon = true;
    else if (a === BG_FLAG) o.bg = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--")) {
      console.error(`未知参数: ${a}（--help 看用法）`);
      process.exit(2);
    } else pos.push(a);
  }
  o.id = pos[0] ?? null;
  o.model = pos[1] ?? null;
  return o;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return listFiles(full);
      return e.name.endsWith(".json") ? [full] : [];
    });
  } catch {
    return [];
  }
}

/** 按 id 或前缀找 agent 记录 */
function findAgentFile(home, idOrPrefix) {
  const files = listFiles(path.join(home, "agents"));
  for (const f of files) {
    let j;
    try {
      j = readJson(f);
    } catch {
      continue;
    }
    if (typeof j.id === "string" && (j.id === idOrPrefix || j.id.startsWith(idOrPrefix))) {
      return { file: f, json: j };
    }
  }
  return null;
}

/** 按 agent id 找 creation 记录（daemon 启动时是从这里恢复的） */
function findCreationFile(home, agentId) {
  for (const f of listFiles(path.join(home, "creations"))) {
    let j;
    try {
      j = readJson(f);
    } catch {
      continue;
    }
    const s = j?.snapshot;
    if (!s) continue;
    // id 可能在 snapshot.agentId（实测是这里），也可能在 snapshot.agent.id
    const candidates = [s.agentId, s.id, s.agent?.id, s.agent?.agentId].filter(Boolean);
    if (candidates.includes(agentId)) return { file: f, json: j, hasAgentModel: s.agent?.model !== undefined };
  }
  return null;
}

/** 记录里所有 model 所在的路径（agent 记录 4 处；creation 1 处另外算） */
const AGENT_MODEL_PATHS = [
  ["config", "model"],
  ["runtimeInfo", "model"],
  ["runtimeInfo", "extra", "runtimeModel"],
  ["persistence", "metadata", "model"],
];

function getAt(obj, keys) {
  let o = obj;
  for (const k of keys) {
    if (o === null || typeof o !== "object") return undefined;
    o = o[k];
  }
  return o;
}

function setAt(obj, keys, value) {
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] === null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function isSameHome(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function daemonArgs(sub, home) {
  // 必须是 `paseo daemon <sub>`：只写 `paseo stop` 会被解析成 `paseo agent stop`
  // daemon 子命令自己认 --home；同时把环境里的 PASEO_HOME/PASEO_HOST 剥掉，避免指错 daemon
  return ["daemon", sub, "--home", home];
}

const main = (args) => {
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (!args.id || !args.model) {
    console.error("缺参数。用法：node switch-model.mjs <窗口ID|前缀> <新模型名>   （--help 看详情）");
    process.exitCode = 2;
    return;
  }

  const home = path.resolve(args.home || process.env.PASEO_HOME || path.join(HOME_DIR, ".paseo"));
  if (!fs.existsSync(home)) {
    console.error(`找不到 PASEO_HOME：${home}`);
    process.exitCode = 1;
    return;
  }

  const hit = findAgentFile(home, args.id);
  if (!hit) {
    console.error(`在 ${path.join(home, "agents")} 下找不到窗口 ${args.id}。`);
    console.error("先看有哪些窗口：paseo ls -a -g --json");
    process.exitCode = 1;
    return;
  }
  const agentId = hit.json.id;
  const current = getAt(hit.json, ["config", "model"]);

  const creation = findCreationFile(home, agentId);
  if (!creation) {
    console.warn(`⚠ ${path.join(home, "creations")} 里没找到这个窗口的 snapshot。`);
    console.warn("  （旧窗口、或通过桌面 App 建的窗口可能没有。老版本 daemon 是直接从 agents/*.json 恢复的。）");
    console.warn("  照改 agents 记录，**行不行交给后面的校验**：不生效会自动回滚，不会留下半改状态。");
    console.warn("");
  }

  // 改动落在哪些字段上（有的记录可能缺字段，缺的跳过）
  const agentHits = AGENT_MODEL_PATHS.map((p) => ({ path: p, from: getAt(hit.json, p) })).filter(
    (x) => x.from !== undefined,
  );
  const creationFrom = creation ? getAt(creation.json, ["snapshot", "agent", "model"]) : undefined;

  console.log(`窗口    : ${agentId}`);
  console.log(`标题    : ${hit.json.title ?? "(无)"}`);
  console.log(`home    : ${home}`);
  console.log(`模型    : ${current ?? "(空)"}  →  ${args.model}`);
  console.log(`要改的字段：`);
  for (const h of agentHits) console.log(`  agents     ${h.path.join(".")} = ${JSON.stringify(h.from)}`);
  if (creation) console.log(`  creations  snapshot.agent.model = ${JSON.stringify(creationFrom)}`);

  if (current === args.model) {
    console.log("\n当前就是这个模型，不用改。");
    return;
  }

  // 目标窗口就是自己所在窗口 → 停 daemon 会把自己的会话一起停掉
  const selfId = process.env.PASEO_AGENT_ID || null;
  const homeIsCurrent = process.env.PASEO_HOME ? isSameHome(home, process.env.PASEO_HOME) : false;
  if (selfId && selfId === agentId && homeIsCurrent && !args.force) {
    console.error("\n⚠ 你这个窗口就是目标窗口。停/起 daemon 会把你自己的会话一起停掉（消息处理到一半会断）。");
    console.error("  换个普通终端跑；确认现在就要做，加 --force。");
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log("\n[dry-run] 不会改任何东西。真跑的话会：");
    console.log(`  1) 备份涉及到的 json（.bak-<时间戳>）`);
    if (!args.keepDaemon) {
      console.log(`  2) paseo daemon stop --home ${home}`);
      console.log(`  3) 写上面列出的字段`);
      console.log(`  4) paseo daemon start --home ${home}`);
      console.log(`  5) paseo agent inspect 校验，没生效就还原备份并再起一次`);
    } else {
      console.log(`  2) 只写字段，不碰 daemon（要等下次 daemon 重启才生效）`);
    }
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 停 daemon 之前，先确保我们不在它的进程树底下 —— 否则脚本会被一起杀掉（见 paseoAncestor 注释）。
  if (!args.keepDaemon && !args.bg) {
    const anc = paseoAncestor();
    if (anc) {
      const logPath = path.join(home, "switch-model.log");
      const fd = fs.openSync(logPath, "a");
      fs.writeSync(fd, `\n===== ${new Date().toISOString()} 从 daemon 子进程脱钩执行 =====\n`);
      const child = spawn(process.execPath, [SELF, ...process.argv.slice(2), BG_FLAG], {
        detached: true,
        stdio: ["ignore", fd, fd],
        env: process.env,
      });
      child.unref();
      console.log(`\n检测到脚本跑在 paseo daemon 底下（${anc}）。`);
      console.log("停 daemon 会把它自己的子进程一起杀掉 —— 脚本会在那一刻被带走，永远走不到「起 daemon」。");
      console.log(`→ 已把活儿转成独立进程继续（pid ${child.pid}），现在断开也不会影响它。`);
      console.log(`→ 执行日志：${logPath}`);
      console.log(`\n等大约 20 秒，再回来看：`);
      console.log(`  paseo agent inspect <窗口ID> --json   # 校验模型换没换`);
      console.log(`  tail -30 ${logPath}`);
      return;
    }
  }

  const backups = [{ file: hit.file, bak: `${hit.file}.bak-${stamp}` }];
  if (creation) backups.push({ file: creation.file, bak: `${creation.file}.bak-${stamp}` });
  for (const b of backups) fs.copyFileSync(b.file, b.bak);

  const restore = () => {
    for (const b of backups) {
      try {
        fs.copyFileSync(b.bak, b.file);
      } catch {
        /* 还原失败就在下面报出来 */
      }
    }
  };

  let daemonWasRunning = false;
  if (!args.keepDaemon) {
    const st = paseoRun(daemonArgs("status", home), { kind: "none", timeout: 60000 });
    daemonWasRunning = /running/i.test(st.all) || st.code === 0;
    console.log(`\n→ 停 daemon…（当前${daemonWasRunning ? "在跑" : "没在跑"}）`);
    if (daemonWasRunning) {
      const r = paseoRun(daemonArgs("stop", home), { kind: "none", timeout: 120000 });
      if (r.code !== 0) {
        console.error("停 daemon 失败：", r.all.slice(0, 300));
        restore();
        console.error("已还原备份，什么都没改。");
        process.exitCode = 1;
        return;
      }
    }
  }

  // 改文件
  try {
    const aj = readJson(hit.file);
    for (const h of agentHits) setAt(aj, h.path, args.model);
    fs.writeFileSync(hit.file, JSON.stringify(aj, null, 2));

    if (creation) {
      const cj = readJson(creation.file);
      setAt(cj, ["snapshot", "agent", "model"], args.model);
      fs.writeFileSync(creation.file, JSON.stringify(cj, null, 2));
    }
    console.log("→ 字段已写入");
  } catch (e) {
    console.error("写文件失败：", e.message);
    restore();
    console.error("已还原备份。");
    process.exitCode = 1;
    return;
  }

  if (args.keepDaemon) {
    console.log("\n✓ 文件改好了。daemon 还在跑，它内存里仍是旧值 ——");
    console.log("  必须重启 daemon 才会生效（重启会中断正在跑的窗口）。");
    console.log(`  paseo daemon stop --home ${home} && paseo daemon start --home ${home}`);
    return;
  }

  console.log("→ 起 daemon…");
  const startRes = paseoRun(daemonArgs("start", home), { kind: "none", timeout: 300000 });
  if (startRes.code !== 0) {
    console.error("起 daemon 失败：", startRes.all.slice(0, 300));
    console.error("文件已经改成新模型了，但 daemon 没起来 —— 手动再起一次即可：");
    console.error(`  paseo daemon start --home ${home}`);
    process.exitCode = 1;
    return;
  }

  // 校验：inspect 报的 Model 是不是新的
  const ins = paseoRun(["agent", "inspect", agentId, "--json", "--home", home], { kind: "none", timeout: 60000 });
  let got = null;
  try {
    got = JSON.parse(ins.out).Model ?? null;
  } catch {
    /* 解析不了就走下面失败分支 */
  }

  if (got === args.model) {
    console.log(`\n✓ 完成。窗口 ${agentId} 现在的模型是 ${got}`);
    console.log("  LINK / AGENT 没变 —— 对方不用换名片、不用重新配对；重发一次消息即可续上。");
    console.log(`  备份文件（确认没问题可以删）：${backups.map((b) => path.basename(b.bak)).join(" / ")}`);
    return;
  }

  console.error(`\n✗ 校验没过：期望 ${args.model}，daemon 报的是 ${got ?? "(没读出来)"}`);
  console.error("  可能在改动期间有别的写入，或 paseo 版本变了。**正在回滚**…");
  paseoRun(daemonArgs("stop", home), { kind: "none", timeout: 120000 });
  restore();
  paseoRun(daemonArgs("start", home), { kind: "none", timeout: 300000 });
  console.error("  已还原备份并重新起了 daemon。这次没改成，去界面里切，或者把窗口删掉重建。");
  process.exitCode = 1;
};

guardMain(() => main(parseArgs(process.argv.slice(2))));
