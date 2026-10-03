/**
 * 传输层：一条命令怎么送到手机上。
 *
 * 两种传输，自动挑能用的：
 *   1. `adb` —— 桌面/电脑上的 DSH（USB 或无线调试）。最通用。
 *   2. 本机 App 桥（http://127.0.0.1:3081/shell）—— 当 DSH **就跑在手机上**时用这条；
 *      它背后的特权通道（Shizuku）等价于 adb shell。
 *
 * 为什么要有第二种：插件既能给电脑上的 DSH 用，也能给装在手机里的 DSH 用，
 * 而且**开发时就能在这台手机上自测**，不用电脑。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const BRIDGE = process.env.DSH_ANDROID_BRIDGE || 'http://127.0.0.1:3081';
const PREFS = process.env.DSH_ANDROID_PREFS || '/data/data/com.deepseek.harness/shared_prefs/dsh_prefs.xml';
const ADB = process.env.DSH_ADB || 'adb';

const short = (s, n = 400) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s);

/** 手机里那份 DSH 的本地令牌（/shell 需要它；读不到说明不是"手机上的 DSH"）。 */
function localToken() {
  try {
    const xml = fs.readFileSync(PREFS, 'utf8');
    return (/name="local_token">([a-f0-9]{16,})</.exec(xml) ?? [])[1] ?? '';
  } catch {
    return '';
  }
}

/** adb 可用吗？有哪些设备？ */
export async function detectAdb(timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(ADB, ['devices', '-l'], { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: short(String(err.message || err), 200) });
      const devices = String(stdout || '')
        .split('\n')
        .slice(1)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [serial, ...rest] = l.split(/\s+/);
          return { serial, state: rest[0] ?? '', detail: rest.slice(1).join(' ') };
        });
      resolve({ ok: true, devices });
    });
  });
}

/** 本机 App 桥可用吗（DSH 跑在手机上时）。 */
export async function detectBridge(timeoutMs = 5000) {
  try {
    const r = await fetch(`${BRIDGE}/status`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return { ok: !!j.ok, token: localToken() ? 'present' : 'missing', engineReady: !!j.engineReady };
  } catch (e) {
    return { ok: false, error: short(String(e.message || e), 160) };
  }
}

/** 两条传输的现状（给模型看的"我能不能干活"）。 */
export async function detect() {
  const [adb, bridge] = await Promise.all([detectAdb(), detectBridge()]);
  const usable = adb.ok && adb.devices.some((d) => d.state === 'device')
    ? 'adb'
    : (bridge.ok && localToken() ? 'bridge' : null);
  return { adb, bridge, usable };
}

/**
 * 在手机上跑一条 shell：优先 adb，其次本机桥。
 * @returns {{ok:boolean, stdout?:string, stderr?:string, via?:string, error?:string}}
 */
export async function sh(command, { timeoutMs = 20000, via } = {}) {
  if (via !== 'bridge') {
    const adb = await detectAdb();
    if (adb.ok && adb.devices.some((d) => d.state === 'device')) {
      const a = await new Promise((resolve) => {
        execFile(ADB, ['shell', command], { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
          (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr, error: err ? short(String(err.message || err), 200) : undefined }));
      });
      if (a.ok || via === 'adb') return { ...a, via: 'adb' };
    }
  }
  const token = localToken();
  if (!token) return { ok: false, error: '没有可用的传输：adb 不可用，且本机桥需要 DSH 跑在手机上（读不到 local_token）' };
  try {
    const r = await fetch(`${BRIDGE}/shell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, command, timeout_ms: timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 5000),
    });
    const j = await r.json();
    return { ok: !!j.ok, stdout: j.stdout ?? '', stderr: j.stderr ?? '', via: 'bridge', error: j.ok ? undefined : short(j.error || 'shell 失败', 200) };
  } catch (e) {
    return { ok: false, error: short(String(e.message || e), 200) };
  }
}
