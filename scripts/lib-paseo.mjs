#!/usr/bin/env node
/**
 * lib-paseo.mjs — setup.mjs / ask.mjs 共用：定位 paseo CLI、给子进程拼 env、预检、顶层兜底。
 *
 * 只依赖 paseo CLI，不碰 Paseo 桌面 App。（曾经有个 peers.mjs 从 App 的 Electron 数据里
 * 挖 host 别名，因为跟我们的名册是两套名字、只会让人更晕，已删除。）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

// ────────────────────────────────────────────────────────────────────────────
// 定位 paseo CLI
// ────────────────────────────────────────────────────────────────────────────

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// PATH 里的目录列表。Git Bash / MSYS 下 PATH 有时是 POSIX 形式（/d/foo/bar，用 ":" 分隔），
// 而 win32 的 path.delimiter 是 ";"——那样整串会缩成一个"目录"，一个都查不到。这里兜一下。
function pathDirs() {
  const raw = process.env.PATH || "";
  const parts = raw.split(path.delimiter);
  if (process.platform === "win32" && parts.length === 1 && /(^|:)\/[a-zA-Z]\//.test(raw)) {
    return raw.split(":");
  }
  return parts;
}

// Git Bash 的 PATH 条目形如 /d/work/x → Windows 原生 Node 需要 D:\work\x
function toWinPath(p) {
  return process.platform === "win32" && /^\/[a-zA-Z]\//.test(p)
    ? p[1].toUpperCase() + ":\\" + p.slice(3).replace(/\//g, "\\")
    : null;
}

// PATH 里找可执行文件（不 spawn，纯查文件系统；Windows 认 PATHEXT）
function which(cmd) {
  const isWin = process.platform === "win32";
  const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  // 名字已经带扩展名（paseo.cmd）就**别再用 PATHEXT 拼**——否则会拼出
  // paseo.cmd.EXE / paseo.cmd.CMD 这种永远不存在的名字，Windows 上必然找不到 paseo。
  const names = isWin ? (/\.[a-z0-9]+$/i.test(cmd) ? [cmd] : pathext.map((e) => cmd + e)) : [cmd];
  for (const dir of pathDirs()) {
    if (!dir) continue;
    const alt = toWinPath(dir);
    for (const d of alt ? [dir, alt] : [dir]) {
      for (const n of names) {
        const p = path.join(d, n);
        if (isExecutable(p)) return p;
      }
    }
  }
  return null;
}

// Windows 上游没把安装目录名写死（NSIS 按用户装），所以这里扫一层目录而不是硬编码路径
function scanWinDir(root, depth = 2) {
  const out = [];
  const walk = (dir, d) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name, "resources", "bin", "paseo.cmd");
      if (isExecutable(p)) out.push(p);
      if (d > 0) walk(path.join(dir, e.name), d - 1);
    }
  };
  walk(root, depth);
  return out;
}

/**
 * 找 paseo CLI。返回 { cmd, source } 或 null。
 * 顺序：$PASEO_CLI（Paseo 自己注入的）> PATH > 桌面 App 自带 CLI。
 * 桌面 App 那条是给"只装了 App、没跑过 npm"的人兜底的——他们其实有 daemon，别让人白装第二份。
 */
export function findPaseo() {
  const envCmd = process.env.PASEO_CLI;
  if (envCmd && isExecutable(envCmd)) return { cmd: envCmd, source: "PASEO_CLI" };

  const onPath = which(process.platform === "win32" ? "paseo.cmd" : "paseo");
  if (onPath) return { cmd: onPath, source: "PATH" };

  const home = os.homedir();
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Paseo.app/Contents/Resources/bin/paseo",
      path.join(home, "Applications/Paseo.app/Contents/Resources/bin/paseo"),
    );
  } else if (process.platform === "linux") {
    candidates.push(
      "/opt/Paseo/resources/bin/paseo",
      path.join(home, ".local/bin/paseo"),
    );
    // AppImage：解包目录随机，扫 /tmp 下的挂载点太脏，靠 $APPDIR（App 运行时会设）
    if (process.env.APPDIR) candidates.push(path.join(process.env.APPDIR, "resources/bin/paseo"));
  } else if (process.platform === "win32") {
    for (const root of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"), process.env.PROGRAMFILES]) {
      if (root) candidates.push(...scanWinDir(root));
    }
  }
  for (const c of candidates) {
    if (c && isExecutable(c)) return { cmd: c, source: "app" };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 子进程 env：paseo CLI 见到 PASEO_HOME 和 PASEO_HOST 同时存在会直接报
// TARGET_AMBIGUOUS 拒绝执行（连 daemon pair 都拿不到输出），所以按调用类型只留一个。
// ────────────────────────────────────────────────────────────────────────────

/**
 * @param kind "host"  客户端命令（ls/run/send/logs/wait/inspect）→ 只留 PASEO_HOST
 *             "home"  daemon 子命令（status/pair/onboard/stop）    → 只留 PASEO_HOME
 *             "none" 不挑目标（如 --version）                      → 两个都不留，走默认解析
 * @param host 目标 daemon 的 listen（kind=host 时用）
 * @param home Paseo home 目录（kind=home 时用；不传则沿用环境里的 PASEO_HOME）
 *
 * 注意"只留一个"必须真的把另一个**从 env 里删掉**——直接 `{...process.env, PASEO_HOST: x}`
 * 是删不掉的（PASEO_HOME 来自 process.env，spread 之后再赋值并不能移除）。
 * PASEO_LISTEN 一律删：它会把 run/ls 劫持到别的 daemon。
 */
export function paseoEnv(kind, { host = null, home = null } = {}) {
  const env = { ...process.env };
  delete env.PASEO_LISTEN;
  if (kind === "host") {
    if (host) env.PASEO_HOST = host;
    else delete env.PASEO_HOST;
    delete env.PASEO_HOME;
  } else if (kind === "home") {
    // home 传了就用它；没传则**保留**环境里原有的 PASEO_HOME——那代表"本机默认 daemon"，
    // 删掉的话 daemon 子命令会退到 CLI 自己的默认解析，home 非默认时就操作错 daemon 了。
    if (home) env.PASEO_HOME = home;
    delete env.PASEO_HOST;
  } else {
    delete env.PASEO_HOST;
    delete env.PASEO_HOME;
  }
  return env;
}

let resolved = null; // 模块级缓存，避免每调一次 paseo 都查一遍磁盘
export function paseoCmd() {
  if (!resolved) resolved = findPaseo();
  return resolved?.cmd ?? "paseo"; // 没找到也返回字面量：spawn 会 ENOENT，由预检先拦住
}

/**
 * 跑一条 paseo 命令。参数同 paseoEnv，另加 timeout。
 * 返回 { code, error, out, all }；paseo 不在时 code=null、error 有值（不抛）。
 */
export function paseoRun(args, { kind = "none", host = null, home = null, timeout = 120000 } = {}) {
  const shell = process.platform === "win32"; // Windows 要跑 paseo.cmd，得走 shell
  const cmd = paseoCmd();
  const [c, ...rest] = shell
    ? [[cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, "")}"` : a)).join(" ")]
    : [cmd, ...args];
  const res = spawnSync(c, rest, {
    encoding: "utf8",
    shell,
    env: paseoEnv(kind, { host, home }),
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const strip = (s) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();
  return {
    code: res.status,
    error: res.error ?? null,
    out: strip(res.stdout),
    all: strip(`${res.stdout ?? ""}${res.stderr ?? ""}`),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 预检：找到 paseo 并能报出版本
// ────────────────────────────────────────────────────────────────────────────

function npmBinHint() {
  // npm 9+ 删掉了 `npm bin -g`（跑了只会得到 Unknown command: "bin"），现在要 npm prefix -g。
  // Windows 上 prefix 本身就是全局 bin 目录，Unix 还要拼个 /bin。
  return process.platform === "win32"
    ? "npm prefix -g   # 那个目录本身就是全局 bin，把它加进 PATH"
    : "npm prefix -g   # 输出的目录后面加 /bin，再把结果加进 PATH";
}

export function precheckPaseo() {
  const found = findPaseo();
  if (!found) {
    console.error("找不到 paseo CLI——它没装，或装了但不在 PATH 上。");
    console.error("");
    console.error("① 如果这台机器装过 Paseo 桌面 App：它自带一份 CLI，不需要再装第二份。");
    console.error("   脚本这次没自动找到它，可以手动把 App 里的 CLI 软链到 PATH（App 官方预期用法）：");
    if (process.platform === "darwin") {
      console.error('   ln -sf "/Applications/Paseo.app/Contents/Resources/bin/paseo" ~/.local/bin/paseo');
    } else if (process.platform === "win32") {
      console.error("   Windows 上 CLI 在 <安装目录>\\resources\\bin\\paseo.cmd，把那个目录加进 PATH。");
    } else {
      console.error("   Linux 上 CLI 在 /opt/Paseo/resources/bin/paseo，软链到 ~/.local/bin/ 即可。");
    }
    console.error("");
    console.error("② 如果确实没装：先装 Node 18+，再装 CLI");
    console.error("   npm i -g @getpaseo/cli");
    console.error(`   装完还报找不到 = npm 全局 bin 不在 PATH：${npmBinHint()}`);
    console.error("");
    console.error("装好后重跑本脚本即可继续，不用改别的。");
    return null;
  }

  const v = paseoRun(["--version"], { timeout: 30000 });
  const version = (v.all.match(/\d+\.\d+\.\d+/) || [])[0] || null;
  if (v.code !== 0 || !version) {
    console.error(`paseo CLI 在 ${found.cmd}，但跑不起来（\`paseo --version\` 失败）。`);
    if (v.error) console.error(`  ${v.error.message}`);
    if (v.all) console.error(`  原始输出：${v.all.slice(0, 300)}`);
    console.error("  桌面 App 自带的那份需要 App 本体完好；也可以 npm i -g @getpaseo/cli 装一份独立的。");
    return null;
  }

  if (found.source === "app") {
    console.log(`→ 用的是 Paseo 桌面 App 自带的 CLI：${found.cmd}`);
    console.log(
      `  （不在 PATH 上。想手动敲 paseo 命令的话：${
        process.platform === "win32" ? "把它的目录加进 PATH" : `ln -sf "${found.cmd}" ~/.local/bin/paseo`
      }）`,
    );
  } else if (found.source === "PASEO_CLI") {
    console.log(`→ 用的是 $PASEO_CLI 指定的 CLI：${found.cmd}`);
  }
  return { cmd: found.cmd, version, source: found.source };
}

// ────────────────────────────────────────────────────────────────────────────
// 顶层兜底：任何非预期异常都别吐 Node 堆栈
// ────────────────────────────────────────────────────────────────────────────

/**
 * 包住 main()。默认只打一行"内部错误 + 原始信息 + 退出码 1"；PASEO_DEBUG=1 才吐完整栈
 * （不然本该暴露的编程错误会被人话盖住，出问题没法查）。
 * ask.mjs 是 async，所以顺带接 unhandledRejection。
 */
export function guardMain(fn) {
  const report = (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.PASEO_DEBUG) {
      console.error(err instanceof Error ? err.stack || err.message : String(err));
    } else {
      console.error("⚠ 内部错误——这不是环境问题，是脚本自己的 bug：");
      console.error(`  ${msg}`);
      console.error("  加 PASEO_DEBUG=1 重跑可看完整堆栈；把这段输出原样发给维护者。");
    }
    process.exitCode = 1;
  };
  process.on("unhandledRejection", report);
  try {
    const r = fn();
    if (r && typeof r.then === "function") r.catch(report);
  } catch (err) {
    report(err);
  }
}
