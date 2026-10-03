/**
 * 虚拟屏核心的客户端：建屏 / 起 App / 取帧 / 点按 / 滑动 / 销毁。
 *
 * 核心（跑在手机上、shell 身份）与插件（跑在 DSH 里）之间就一个 HTTP：
 *   /vscreen/ping /status /create?width&height&dpi /launch?pkg /see /tap?x&y
 *   /swipe?x1&y1&x2&y2&dur /key?keycode /close
 *
 * 核心端点从哪来（按顺序）：
 *   1. 环境变量 DSH_VSCREEN_URL（明确指定，最优先）
 *   2. 手机上那份 DSH 自带的桥：http://127.0.0.1:8998（Android 版 DSH 会常驻一个核心）
 *   3. adb：把随包的核心 jar 推到 /data/local/tmp 起来，再 adb forward 到本机
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { sh, detect } from './transport.js';

const PORT_HINT = Number(process.env.DSH_VSCREEN_PORT || 8998);
const PRIVATE_PORT = Number(process.env.DSH_VSCREEN_PRIVATE_PORT || 8990);
const CORE_CLASS = 'com.deepseek.harness.vscreen.Main';
const REMOTE_JAR = '/data/local/tmp/vscreen-core.jar';
const ADB = process.env.DSH_ADB || 'adb';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 本地（本插件包内）的核心 jar；随包分发，供 adb 场景推上去。 */
export function bundledJar() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const p = path.join(here, '..', 'assets', 'vscreen-core.jar');
  return fs.existsSync(p) ? p : null;
}

/** 决定这次用哪个核心端点。 */
export async function resolveCore() {
  const explicit = process.env.DSH_VSCREEN_URL;
  if (explicit) {
    const ok = await ping(explicit);
    if (ok) return { base: explicit, how: 'env' };
  }
  // 手机上那份 DSH 的桥（核心常驻 8998）
  const d = await detect();
  if (d.usable === 'bridge') {
    const base = `http://127.0.0.1:${PORT_HINT}`;
    if (await ping(base)) return { base, how: 'on-device bridge (8998)' };
  }
  return { base: null, how: 'none' };
}

async function ping(base, timeoutMs = 3000) {
  try {
    const r = await fetch(`${base}/vscreen/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return !!j.ok;
  } catch {
    return false;
  }
}

/** 通过 adb 把随包核心拉起来（桌面场景）。 */
export async function startCoreViaAdb() {
  const jar = bundledJar();
  if (!jar) return { ok: false, error: '插件包里没有 assets/vscreen-core.jar（桌面/ adb 场景需要它）' };
  const push = await new Promise((resolve) => execFile(ADB, ['push', jar, REMOTE_JAR], { timeout: 60000 },
    (e) => resolve(e ? { ok: false, error: String(e.message || e) } : { ok: true })));
  if (!push.ok) return push;
  const cmd = `CLASSPATH=${REMOTE_JAR} /system/bin/app_process /system/bin ${CORE_CLASS} --port ${PRIVATE_PORT} --dir /sdcard/DeepSeekHarness >/dev/null 2>&1 &`;
  await sh(cmd, { timeoutMs: 15000, via: 'adb' });
  await new Promise((resolve) => execFile(ADB, ['forward', `tcp:${PRIVATE_PORT}`, `tcp:${PRIVATE_PORT}`], { timeout: 15000 }, () => resolve()));
  const base = `http://127.0.0.1:${PRIVATE_PORT}`;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await ping(base)) return { ok: true, base, how: 'adb + bundled core' };
  }
  return { ok: false, error: '核心起来后 10 秒内没有响应 /vscreen/ping' };
}

/** 统一入口：拿到能用的核心端点（必要时自己拉起）。 */
export async function ensureCore() {
  const r = await resolveCore();
  if (r.base) return r;
  const d = await detect();
  if (d.usable === 'adb') return startCoreViaAdb();
  return { base: null, how: 'none', error: '没有可用核心：既不是"DSH 跑在手机上"，也没有 adb' };
}

async function call(base, route, timeoutMs = 20000) {
  const r = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(timeoutMs) });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { ok: false, error: `非 JSON 响应: ${t.slice(0, 200)}` };
  }
}

export const status = (base) => call(base, '/vscreen/status', 6000);
export const create = (base, w, h, dpi) => call(base, `/vscreen/create?width=${w}&height=${h}&dpi=${dpi}`, 20000);
export const launch = (base, pkg) => call(base, `/vscreen/launch?pkg=${encodeURIComponent(pkg)}`, 30000);
export const see = (base) => call(base, '/vscreen/see', 30000);
export const tap = (base, x, y) => call(base, `/vscreen/tap?x=${Math.round(x)}&y=${Math.round(y)}`, 15000);
export const swipe = (base, x1, y1, x2, y2, dur) =>
  call(base, `/vscreen/swipe?x1=${Math.round(x1)}&y1=${Math.round(y1)}&x2=${Math.round(x2)}&y2=${Math.round(y2)}&dur=${dur}`, 15000);
export const close = (base) => call(base, '/vscreen/close', 20000);

/**
 * 主屏（display #0）当前前台包名 —— 用来证明"我们没碰你的屏幕"。
 * 刻意不用无障碍：无障碍会把**虚拟屏上的 App** 误报成前台。
 */
export async function mainDisplayTop() {
  const r = await sh("dumpsys activity activities | grep -E 'Display #|topResumedActivity'", { timeoutMs: 20000 });
  if (!r.ok) return { ok: false, error: r.error || 'dumpsys 失败' };
  const lines = String(r.stdout || '').split('\n');
  let cur = -1;
  for (const line of lines) {
    const d = /Display #(\d+)/.exec(line);
    if (d) { cur = Number(d[1]); continue; }
    if (cur === 0 && line.includes('topResumedActivity')) {
      const m = /\s([a-zA-Z0-9._]+)\//.exec(line.replace('topResumedActivity=', ' '));
      if (m) return { ok: true, pkg: m[1] };
    }
  }
  return { ok: false, error: '没解析出 Display #0 的前台' };
}
