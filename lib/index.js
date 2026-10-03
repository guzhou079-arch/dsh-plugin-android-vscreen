/**
 * dsh-plugin-android-vscreen —— 让 AI 在安卓的「虚拟屏」上干活。
 *
 * 关键点：所有点击/滑动都打在**虚拟显示器**上（`input -d <displayId>`），
 * 手机自己的屏幕照常用。每个动作都带一条"主屏自证"：报告主屏前台有没有被动过。
 *
 * v0.1（M1）：status / start / see / tap / swipe / close + doctor。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { detect, sh } from './transport.js';
import * as core from './core.js';

export const name = 'android-vscreen';
export const inject = ['tools'];

const ADB = process.env.DSH_ADB || 'adb';

const OUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      via: { type: 'string' },
      displayId: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      path: { type: 'string' },
      mainBefore: { type: 'string' },
      mainAfter: { type: 'string' },
      mainUnchanged: { type: 'boolean' },
      text: { type: 'string' },
      error: { type: 'string' },
    },
  },
  render: (_a, v) => (v && (v.text || v.error)) || JSON.stringify(v),
};

/** 需要核心就用它；返回 {base} 或抛错。 */
async function needCore() {
  const r = await core.ensureCore();
  if (!r.base) throw new Error(r.error || '没有可用的虚拟屏核心');
  return r;
}

/** adb 场景：把设备上的截图拉到本机，返回本地路径（本机 DSH 直接用设备路径）。 */
async function fetchShot(remotePath) {
  const d = await detect();
  if (d.usable !== 'adb') return remotePath;
  const dest = path.join(os.tmpdir(), `vscreen-${Date.now()}.png`);
  const ok = await new Promise((resolve) => execFile(ADB, ['pull', remotePath, dest], { timeout: 60000 },
    (e) => resolve(!e)));
  return ok ? dest : remotePath;
}

export function apply(ctx) {
  // ── 诊断：我能不能干活、走哪条传输 ──
  ctx.tools.register(defineTool({
    name: 'android_vscreen_doctor',
    description:
      '检查能不能操作安卓手机（以及走哪条传输）：列出 adb 设备、探测手机本地桥、探测虚拟屏核心。'
      + '动手前先调它 —— 没有可用传输时后续工具都会失败。',
    parameters: { probe: { type: 'string', description: '可选：顺带在手机上执行的 shell 命令' } },
    output: OUT,
    async execute(args) {
      const d = await detect();
      const c = await core.ensureCore();
      const lines = [
        `可用传输: ${d.usable ?? '（无）'}`,
        `adb: ${d.adb.ok ? JSON.stringify(d.adb.devices.map((x) => x.serial + ':' + x.state)) : '不可用（' + (d.adb.error || '') + '）'}`,
        `本机桥: ${d.bridge.ok ? `在（token ${d.bridge.token}）` : '不可用（' + (d.bridge.error || '') + '）'}`,
        `虚拟屏核心: ${c.base ? `${c.base}（${c.how}）` : '没有（' + (c.error || c.how) + '）'}`,
      ];
      if (d.usable) {
        const probe = String(args.probe || 'getprop ro.product.model');
        const r = await sh(probe, { timeoutMs: 15000 });
        lines.push(`探针 \`${probe}\`: ${r.ok ? String(r.stdout || '').trim().slice(0, 200) : '失败 ' + r.error}`);
      }
      return { ok: !!(d.usable && c.base), via: d.usable ?? undefined, text: lines.join('\n') };
    },
  }));

  // ── 虚拟屏状态 ──
  ctx.tools.register(defineTool({
    name: 'android_vscreen_status',
    description: '看虚拟屏当前状态（displayId / 尺寸 / 是否在跑）。动手前先看它。',
    parameters: {},
    output: OUT,
    async execute() {
      const { base, how } = await needCore();
      const st = await core.status(base);
      return {
        ok: !!st.ok, via: how, displayId: st.displayId, width: st.width, height: st.height,
        text: st.running ? `虚拟屏在跑：displayId=${st.displayId} ${st.width}x${st.height}` : '虚拟屏未运行',
      };
    },
  }));

  // ── 建屏 + 把 App 起上去（不碰主屏）──
  ctx.tools.register(defineTool({
    name: 'android_vscreen_start',
    description:
      '建一块虚拟屏（默认 1080x1920@420），可选把一个 App 启动到这块屏上。'
      + '**你的物理屏幕不会被动**：返回里带 mainBefore/mainAfter 作为自证。',
    parameters: {
      pkg: { type: 'string', description: '要启动到虚拟屏的包名（可省略，之后再起）' },
      width: { type: 'number', description: '宽（默认 1080）' },
      height: { type: 'number', description: '高（默认 1920）' },
      dpi: { type: 'number', description: '密度（默认 420）' },
      waitMs: { type: 'number', description: '起 App 后等多久（默认 2500）' },
    },
    output: OUT,
    async execute(args) {
      const { base, how } = await needCore();
      const before = await core.mainDisplayTop();
      let st = await core.status(base);
      if (!st.running) {
        const c = await core.create(base, Number(args.width) || 1080, Number(args.height) || 1920, Number(args.dpi) || 420);
        if (!c.ok) return { ok: false, error: `建屏失败：${c.error ?? JSON.stringify(c).slice(0, 160)}` };
        await new Promise((r) => setTimeout(r, 1200));
        st = await core.status(base);
      }
      const lines = [`虚拟屏: displayId=${st.displayId} ${st.width}x${st.height}（经由 ${how}）`];
      if (args.pkg) {
        const l = await core.launch(base, String(args.pkg));
        if (!l.ok) return { ok: false, error: `启动 ${args.pkg} 到虚拟屏失败：${l.error ?? JSON.stringify(l).slice(0, 160)}`, displayId: st.displayId };
        await new Promise((r) => setTimeout(r, Number(args.waitMs) || 2500));
        lines.push(`已把 ${args.pkg} 启动到虚拟屏`);
      }
      const after = await core.mainDisplayTop();
      const unchanged = before.ok && after.ok && before.pkg === after.pkg;
      lines.push(`主屏自证: ${before.pkg ?? '?'} → ${after.pkg ?? '?'} ${unchanged ? '（没变 ✓）' : '（有变化，注意）'}`);
      return {
        ok: true, via: how, displayId: st.displayId, width: st.width, height: st.height,
        mainBefore: before.pkg, mainAfter: after.pkg, mainUnchanged: unchanged, text: lines.join('\n'),
      };
    },
  }));

  // ── 取帧（存 PNG，返回路径）──
  ctx.tools.register(defineTool({
    name: 'android_vscreen_see',
    description: '截取**虚拟屏**当前的画面并存成 PNG，返回文件路径（主屏不受影响）。',
    parameters: {},
    output: OUT,
    async execute() {
      const { base, how } = await needCore();
      const r = await core.see(base);
      if (!r.ok) return { ok: false, error: `取帧失败：${r.error ?? JSON.stringify(r).slice(0, 160)}` };
      const p = await fetchShot(r.path);
      return { ok: true, via: how, displayId: r.displayId, width: r.screenW, height: r.screenH, path: p, text: `虚拟屏 ${r.screenW}x${r.screenH} → ${p}` };
    },
  }));

  // ── 只在虚拟屏上点按 ──
  ctx.tools.register(defineTool({
    name: 'android_vscreen_tap',
    description: '在**虚拟屏**上点一下（x/y 是虚拟屏像素；用 android_vscreen_see 的尺寸换算）。'
      + '⚠️ 虚拟屏只隔离**画面**、不隔离**副作用**：你点的开关会真的改设备状态（飞行模式 / Wi-Fi / 勿扰…）。'
      + '先 see 一拍、按画面里的实际控件位置算坐标，**别**用屏幕比例盲点。物理屏幕本身不受影响。',
    parameters: {
      x: { type: 'number', required: true, description: '虚拟屏像素 x' },
      y: { type: 'number', required: true, description: '虚拟屏像素 y' },
    },
    output: OUT,
    async execute(args) {
      const { base, how } = await needCore();
      const r = await core.tap(base, Number(args.x) || 0, Number(args.y) || 0);
      if (!r.ok) return { ok: false, error: `点按失败：${r.error ?? JSON.stringify(r).slice(0, 160)}` };
      return { ok: true, via: how, text: `已在虚拟屏点 (${Math.round(Number(args.x))},${Math.round(Number(args.y))})` };
    },
  }));

  // ── 只在虚拟屏上滑动 ──
  ctx.tools.register(defineTool({
    name: 'android_vscreen_swipe',
    description: '在**虚拟屏**上滑动（坐标是虚拟屏像素）。主屏不受影响。',
    parameters: {
      x1: { type: 'number', required: true, description: '起点 x' },
      y1: { type: 'number', required: true, description: '起点 y' },
      x2: { type: 'number', required: true, description: '终点 x' },
      y2: { type: 'number', required: true, description: '终点 y' },
      dur: { type: 'number', description: '时长毫秒（默认 300）' },
    },
    output: OUT,
    async execute(args) {
      const { base, how } = await needCore();
      const r = await core.swipe(base, Number(args.x1) || 0, Number(args.y1) || 0, Number(args.x2) || 0, Number(args.y2) || 0, Number(args.dur) || 300);
      if (!r.ok) return { ok: false, error: `滑动失败：${r.error ?? JSON.stringify(r).slice(0, 160)}` };
      return { ok: true, via: how, text: '已在虚拟屏滑动' };
    },
  }));

  // ── 销毁虚拟屏 ──
  ctx.tools.register(defineTool({
    name: 'android_vscreen_close',
    description: '销毁虚拟屏（上面的 App 一起结束；物理屏幕不受影响）。',
    parameters: {},
    output: OUT,
    async execute() {
      const { base, how } = await needCore();
      const r = await core.close(base);
      if (!r.ok) return { ok: false, error: `销毁失败：${r.error ?? JSON.stringify(r).slice(0, 160)}` };
      return { ok: true, via: how, text: '虚拟屏已销毁' };
    },
  }));
}
