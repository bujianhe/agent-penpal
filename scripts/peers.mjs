#!/usr/bin/env node
/**
 * peers.mjs — 从 Paseo 桌面 App 的本地数据里直接提取已配对 host 的配对链接。
 *
 * 原理：桌面 App（Electron）把已配对的 host 存在 Chromium LocalStorage 的
 * "@paseo:daemon-registry" 里（含 serverId、relay 端点、daemon 公钥）。
 * Electron 开了调试端口（CDP）时，本脚本连上去实时读出这份数据，
 * 反推出配对链接 https://app.paseo.sh/#offer=...
 *
 * 用法:
 *   node peers.mjs                  列出所有已配对 host 及配对链接
 *   node peers.mjs <别名>           按别名查一台，只输出它的配对链接
 *   node peers.mjs --user-data DIR  指定 App 的 userData 目录
 *   node peers.mjs --port N         直接指定 CDP 端口
 *   node peers.mjs --json           输出 JSON（label / serverId / offerUrl）
 *
 * 要求：Node 21+；桌面 App 正在运行且开了调试端口
 *（dev 启动脚本默认开；打包版启动时加 --remote-debugging-port=9223）。
 * App 数据目录自动找：打包版 Windows %APPDATA%/@getpaseo/desktop、Linux ~/.config/@getpaseo/desktop；
 * dev 在 packages/desktop/.dev/user-data。都不在时用 --user-data 指定。
 *
 * 注意：OFFER_URL 是对目标 daemon 的完整控制权，当密钥保管，别外传。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const KEY = "@paseo:daemon-registry";
const APP_BASE = "https://app.paseo.sh";
const DEFAULT_CDP_PORT = 9223;
// 数据目录找不到时兜底扫描的常见调试端口（9222 = Chrome 默认；9223 = Paseo dev 默认）
const SWEEP_PORTS = Array.from({ length: 11 }, (_, i) => 9222 + i);

if (typeof WebSocket === "undefined") {
  console.error("需要 Node 21+（内置 WebSocket）。当前版本: " + process.version);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { json: false, port: null, userData: null, label: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--user-data") out.userData = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) {
      if (out.label) {
        console.error("只能给一个别名（多余的: " + a + "）");
        process.exit(2);
      }
      out.label = a;
    } else {
      console.error(`未知参数: ${a}（--help 看用法）`);
      process.exit(2);
    }
  }
  return out;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function appDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || null;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function candidateUserDataDirs() {
  const dirs = [];
  const push = (d) => {
    if (d && !dirs.includes(d) && isDir(d)) dirs.push(d);
  };

  if (process.env.PASEO_USER_DATA) push(process.env.PASEO_USER_DATA);

  // 从当前目录往上找仓库 checkout 里的桌面 dev 状态
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    push(path.join(cur, "packages", "desktop", ".dev", "user-data"));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 系统 AppData：Paseo / Paseo-<worktree> / @getpaseo/desktop（打包版默认）
  const root = appDataRoot();
  if (root && isDir(root)) {
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      if (/^paseo([-.]|$)/i.test(name) && isDir(full)) push(full);
      if (name === "@getpaseo" || name === "@paseo") {
        for (const sub of fs.readdirSync(full)) push(path.join(full, sub));
      }
    }
  }
  return dirs;
}

function readPortFrom(dir) {
  try {
    const first = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0].trim();
    const port = Number(first);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

async function probePort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function findEndpoint(args) {
  if (args.port) {
    if (await probePort(args.port)) return { port: args.port, dir: null };
    console.error(`指定端口 ${args.port} 连不上（App 没跑？端口不对？）`);
    return null;
  }

  const dirs = args.userData ? [args.userData] : candidateUserDataDirs();
  const seen = new Set();
  for (const dir of dirs) {
    const port = readPortFrom(dir);
    if (!port || seen.has(port)) continue;
    seen.add(port);
    if (await probePort(port)) return { port, dir };
  }

  // 数据目录找不到（如在任意目录下运行）：扫常见调试端口，用 @paseo:* 存储键确认是 Paseo 而非别的浏览器
  for (const port of SWEEP_PORTS) {
    if (seen.has(port)) continue;
    seen.add(port);
    if (!(await probePort(port))) continue;
    try {
      const isPaseo = await evaluateInPage(
        port,
        `Object.keys(localStorage).some((k) => k.startsWith("@paseo:"))`,
      );
      if (isPaseo === true) return { port, dir: null };
    } catch {
      // 不是 Paseo 或页面没就绪，继续扫
    }
  }

  console.error(
    [
      "找不到可用的调试端口。检查：",
      "  1. 桌面 App 正在运行吗？",
      "  2. dev 启动脚本默认开调试端口；打包版 App 要用带调试端口的方式启动：",
      `     启动时加参数 --remote-debugging-port=${DEFAULT_CDP_PORT}（或设 PASEO_ELECTRON_FLAGS）`,
      "  3. App 数据目录不在默认位置时，用 --user-data <目录> 指定；端口非默认时用 --port 指定",
      "已找过这些目录:",
      ...(dirs.length ? dirs.map((d) => "  - " + d) : ["  （无）"]),
      `已扫描端口 ${SWEEP_PORTS[0]}-${SWEEP_PORTS[SWEEP_PORTS.length - 1]}`,
    ].join("\n"),
  );
  return null;
}

async function evaluateInPage(port, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pages = targets.filter((t) => t.type === "page" && !String(t.url).startsWith("devtools://"));
  const page = pages.find((t) => /:8081|paseo\.sh|localhost/.test(String(t.url))) || pages[0];
  if (!page) throw new Error("调试端口上没有可用页面（App 界面还没加载完？稍后重试）");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("CDP WebSocket 连接失败"));
  });
  const value = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP 求值超时")), 8000);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text || "页面求值异常"));
      } else {
        resolve(msg.result?.result?.value ?? null);
      }
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }),
    );
  });
  ws.close();
  return value;
}

function readRegistry(port) {
  return evaluateInPage(port, `localStorage.getItem(${JSON.stringify(KEY)})`);
}

function toOfferUrl(profile, conn) {
  const offer = {
    v: 2,
    serverId: profile.serverId,
    daemonPublicKeyB64: conn.daemonPublicKeyB64,
    relay: {
      endpoint: conn.relayEndpoint,
      ...(conn.useTls !== undefined ? { useTls: conn.useTls } : {}),
    },
  };
  return APP_BASE + "/#offer=" + Buffer.from(JSON.stringify(offer), "utf8").toString("base64url");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node peers.mjs [<别名>] [--user-data DIR] [--port N] [--json]");
    console.log("  不带参数：列出所有已配对 host 及配对链接");
    console.log("  带别名  ：按别名查一台，只输出它的配对链接");
    return;
  }

  const endpoint = await findEndpoint(args);
  if (!endpoint) {
    process.exitCode = 1;
    return;
  }
  const { port, dir } = endpoint;
  const stored = await readRegistry(port);
  if (!stored) {
    console.error(`App 数据里没有 ${KEY}（还没配过任何 host？）`);
    process.exitCode = 1;
    return;
  }

  let profiles;
  try {
    profiles = JSON.parse(stored);
  } catch {
    console.error("数据解析失败，前 200 字符: " + String(stored).slice(0, 200));
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(profiles)) {
    console.error("数据不是预期格式（应为数组）");
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const p of profiles) {
    for (const c of p.connections || []) {
      rows.push({
        label: p.label ?? "",
        serverId: p.serverId ?? "",
        type: c.type ?? "?",
        relayEndpoint: c.relayEndpoint ?? c.endpoint ?? null,
        offerUrl: c.type === "relay" && c.relayEndpoint && c.daemonPublicKeyB64 ? toOfferUrl(p, c) : null,
      });
    }
  }

  if (args.label) {
    const want = String(args.label).trim().toLowerCase();
    let matched = rows.filter((r) => r.label.trim().toLowerCase() === want);
    if (matched.length === 0) {
      matched = rows.filter((r) => r.label.toLowerCase().includes(want));
    }
    if (matched.length === 0) {
      console.error(`没找到别名 "${args.label}"。本机已有：` + profiles.map((p) => p.label).join("、"));
      process.exitCode = 1;
      return;
    }
    const labels = [...new Set(matched.map((r) => r.label))];
    if (labels.length > 1) {
      console.error(`"${args.label}" 匹配到多台：` + labels.join("、") + "，请写完整别名");
      process.exitCode = 1;
      return;
    }
    const withUrl = matched.filter((r) => r.offerUrl);
    if (withUrl.length === 0) {
      console.error(
        `"${labels[0]}" 没有配对链接（本地直连 profile）；它自己那条"别人连它"的链接用 \`paseo daemon pair\` 生成。`,
      );
      process.exitCode = 1;
      return;
    }
    if (args.json) console.log(JSON.stringify(withUrl, null, 2));
    else for (const r of withUrl) console.log(r.offerUrl);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(`App 数据目录: ${dir ?? "(未走数据目录，端口扫描发现)"}    调试端口: ${port}`);
  console.log(`已配对 host：${profiles.length} 台\n`);
  for (const r of rows) {
    console.log(`  ${r.label}  [serverId=${r.serverId}]`);
    if (r.offerUrl) {
      console.log(`    OFFER_URL: ${r.offerUrl}`);
    } else {
      console.log(`    （${r.type} 直连 ${r.relayEndpoint ?? "-"}，无配对链接；本机自己的链接用 \`paseo daemon pair\` 生成）`);
    }
  }
  console.log("\n按别名查一台: node peers.mjs <别名>（只输出那条链接，可直接内联进 --host）");
  console.log("OFFER_URL = 对目标 daemon 的完整控制权，当密钥保管，别外传。");
}

main().catch((err) => {
  console.error("出错: " + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
