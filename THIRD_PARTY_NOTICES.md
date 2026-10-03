# Third-party notices

## Virtual-display core (`assets/vscreen-core.jar`)

The bundled core is built from the virtual-display bridge of the **DeepSeek Harness Android port**
(<https://github.com/guzhou079-arch/deepseek-harness-android>), which in turn credits
**Operit** by AAswordman (<https://github.com/AAswordman/Operit>, LGPL-3.0) as the origin of its
virtual-display approach.

Because of that lineage **this plugin is licensed LGPL-3.0-only** (see `LICENSE`) rather than MIT.
The core runs as the `shell` user via `app_process`; it uses only public Android APIs
(`DisplayManager.createVirtualDisplay`, `ImageReader`) plus documented reflection constants.
It does **not** use MediaProjection.

## Runtime peer

- `@deepseek-ai/dsh-tools` — DeepSeek Harness (see the upstream project's license).
