# dsh-plugin-android-vscreen

> **Let an agent work on your Android phone without taking over your screen.**
> 让 AI 在安卓手机的**虚拟显示器**上干活 —— 手机你自己的屏幕照常用，互不打扰。

A [DeepSeek Harness](https://github.com/guzhou079-arch/deepseek-harness-android) plugin.
Tested with DSH on Android; the `adb` transport also works with DSH on a computer.

---

## Why

Most "agent drives my phone" plugins tap the **main screen**: your phone is hijacked while the agent
works — you can't use it, and it can't be used quietly in the background.

Android can create a **virtual display**: a second, invisible screen. The agent launches an app onto
that display, looks at it and taps it there, while the physical screen keeps doing whatever you were
doing. Every action reports a "main-screen proof" (`mainBefore` → `mainAfter`) so you can see the
physical screen was not touched.

## ⚠️ A virtual display isolates the **picture**, not the **effects** / 只隔离画面，不隔离副作用

An app running on a virtual display still acts on the **whole device**. Tap *Airplane mode*, *Wi-Fi*
or *Do not disturb* inside a virtual display and that switch really flips — it is the same system
setting. Installing, sending messages, changing settings: all real.

So *"your screen stays untouched"* is **not** the same as *"your device stays untouched"*.

**Rule for agents using this plugin:** take a frame with `android_vscreen_see` first, and derive tap
coordinates from what you actually see. Never tap a guessed fraction of the screen.

## Tools

| Tool | What it does |
|---|---|
| `android_vscreen_doctor` | Can I drive this device, and over which transport. Run it first. |
| `android_vscreen_status` | Is a virtual display running, and how big is it. |
| `android_vscreen_start` | Create the virtual display and optionally launch an app onto it. |
| `android_vscreen_see` | Grab a frame of the *virtual* display as a PNG. |
| `android_vscreen_tap` | Tap on the virtual display. |
| `android_vscreen_swipe` | Swipe on the virtual display. |
| `android_vscreen_close` | Destroy the virtual display. |

## How it reaches the phone

Two transports, picked automatically:

| Transport | When it's used |
|---|---|
| `adb` | DSH runs on your computer (USB or wireless debugging) |
| local bridge (`127.0.0.1:3081`) | DSH runs **on the phone itself** (e.g. the Android build) |

Both end up as a shell on the device — the same privilege level `adb shell` has. That privilege is
required: an app cannot put *another* app onto a virtual display with its own identity, so the
bundled core runs as `shell` via `app_process`. It uses only public Android APIs
(`DisplayManager.createVirtualDisplay`, `ImageReader`) plus documented reflection constants — **no
MediaProjection**, no screen-capture permission dialog.

## Install

```sh
dsh plugin --profile web add dsh-plugin-android-vscreen
```

From a clone (works whether or not the npm release exists yet):

```sh
git clone https://github.com/guzhou079-arch/dsh-plugin-android-vscreen
dsh plugin --profile web add link:./dsh-plugin-android-vscreen
```

Then ask the agent to run `android_vscreen_doctor`: it reports which transport is available and
probes the device.

## Requirements

- An Android device reachable by `adb` (USB or `adb connect`), **or** DSH running on the phone with
  its privileged shell bridge available.
- Node.js 20+ (whatever your DSH runs on).

## Development

The device side is a small Java program in `assets/vscreen-core.jar`. To rebuild it from source, see
the Android port repository (`android-app/src/com/deepseek/harness/vscreen/`). Two smoke tests run
the whole chain without going through a model:

```sh
node test-m1.mjs            # create → launch → see → tap → see → main-screen proof → close
node vs-safe.mjs start      # same thing, but aimed at a harmless target
```

## License

**LGPL-3.0-only** — see [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
The bundled `assets/vscreen-core.jar` descends from [Operit](https://github.com/AAswordman/Operit)
(LGPL-3.0), which is why this plugin is LGPL rather than MIT.
