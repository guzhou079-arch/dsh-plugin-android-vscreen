// Tap drill against a HARMLESS target (a calculator): no global side effects.
// Usage: node vs-safe.mjs <start|see|tap x y|close>
//
//   node vs-safe.mjs start        # create display + launch the calculator + first frame
//   node vs-safe.mjs see          # another frame
//   node vs-safe.mjs tap 540 1600 # tap one digit (harmless), then frame again
//   node vs-safe.mjs close        # destroy the display
//
// Coordinates must come from the frame you just looked at — not from a screen fraction.
import * as core from './lib/core.js';

// Calculator package names differ per vendor; first one that launches wins.
const CALCULATORS = [
  'com.coloros.calculator',
  'com.android.calculator2',
  'com.google.android.calculator',
  'com.miui.calculator',
  'com.oneplus.calculator',
  'com.android.calculator',
];

const cmd = process.argv[2] || 'start';
const c = await core.ensureCore();
if (!c.base) { console.log('✗ no usable core:', c.error || c.how); process.exit(1); }

const mainNow = async () => (await core.mainDisplayTop()).pkg ?? '?';

if (cmd === 'start') {
  const before = await mainNow();
  let st = await core.status(c.base);
  if (!st.running) {
    await core.create(c.base, 1080, 1920, 420);
    await new Promise((r) => setTimeout(r, 1500));
    st = await core.status(c.base);
  }
  let launched = null;
  for (const pkg of CALCULATORS) {
    const l = await core.launch(c.base, pkg);
    if (l.ok) { launched = pkg; break; }
  }
  await new Promise((r) => setTimeout(r, 2500));
  const s = await core.see(c.base);
  console.log(JSON.stringify({
    display: `${st.displayId} ${st.width}x${st.height}`,
    launched, shot: s.path, mainBefore: before, mainNow: await mainNow(),
  }, null, 1));
} else if (cmd === 'see') {
  const s = await core.see(c.base);
  console.log(JSON.stringify({ shot: s.path, w: s.screenW, h: s.screenH, mainNow: await mainNow() }));
} else if (cmd === 'tap') {
  const x = Number(process.argv[3]), y = Number(process.argv[4]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    console.log('✗ usage: node vs-safe.mjs tap <x> <y>   (take x/y from the frame you just saw)');
    process.exit(1);
  }
  const r = await core.tap(c.base, x, y);
  await new Promise((r2) => setTimeout(r2, 900));
  const s = await core.see(c.base);
  console.log(JSON.stringify({ tap: r, shotAfter: s.path, mainNow: await mainNow() }));
} else if (cmd === 'close') {
  const before = await mainNow();
  const r = await core.close(c.base);
  console.log(JSON.stringify({ closed: r, mainBefore: before, mainAfter: await mainNow() }));
}
