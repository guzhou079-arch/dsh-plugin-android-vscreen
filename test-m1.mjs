// Smoke test: run the whole chain directly (no model involved).
//   ensureCore → main-screen before → create display → launch → see → main-screen after → close
//
// Deliberately does NOT tap. A tap needs coordinates derived from a frame you just looked at;
// tapping a guessed fraction of the screen is how a smoke test once flipped Airplane mode on.
// For the tap drill use the harmless target in vs-safe.mjs instead:
//   node vs-safe.mjs start && node vs-safe.mjs tap <x> <y>
import * as core from './lib/core.js';

const log = (...a) => console.log(...a);
const t0 = Date.now();

const c = await core.ensureCore();
log('① core:', c.base, '(', c.how, ')');
if (!c.base) { log('✗ no usable core, stop'); process.exit(1); }

const before = await core.mainDisplayTop();
log('② main screen before:', before.pkg ?? before.error);

let st = await core.status(c.base);
if (!st.running) {
  const cr = await core.create(c.base, 1080, 1920, 420);
  log('③ create:', JSON.stringify(cr));
  await new Promise((r) => setTimeout(r, 1500));
  st = await core.status(c.base);
} else {
  log('③ already running:', JSON.stringify(st));
}
log('   display:', `displayId=${st.displayId} ${st.width}x${st.height}`);

// Launching an app onto the virtual display has no side effects; only tapping does.
const l = await core.launch(c.base, 'com.android.settings');
log('④ launch:', JSON.stringify(l));
await new Promise((r) => setTimeout(r, 2500));

const s1 = await core.see(c.base);
log('⑤ frame:', JSON.stringify({ ok: s1.ok, w: s1.screenW, h: s1.screenH, path: s1.path }));
log('   (no tap here on purpose — see the header)');

const after = await core.mainDisplayTop();
log('⑥ main screen after:', after.pkg ?? after.error,
  before.pkg === after.pkg ? '→ unchanged ✓ (physical screen untouched)' : '→ changed ⚠️');

const cl = await core.close(c.base);
log('⑦ close:', JSON.stringify(cl));
log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
