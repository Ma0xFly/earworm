# Earworm Playground（离线调试页）

不装扩展、不联网，在普通网页里跑**真实的** `ContentApp`：双语字幕、逐句列表、逐句播放、
模糊、点词词典全部来自 `src/` 的合并实现，只把浏览器扩展环境（`chrome.*`、YouTube 播放器、
字幕生产端、background LLM 调用）换成 mock。

页面模仿 YouTube 观看页：左侧播放器 + 底部控制条，右侧推荐位，顶部一条调试工具栏。

## 启动

要求与本仓库一致：Node.js ≥ 22、pnpm 11。

```bash
pnpm install
pnpm playground
```

打开终端里打印的地址（默认 <http://localhost:5183/>）。`scripts/playground.mjs` 会以
`playground/vite.config.ts` 启动 Vite；端口被占用时 Vite 自动换下一个可用端口。

页面**不发起**真实 YouTube / LLM 请求；ECDICT 词库、lemma、搭配表读取仓库里已提交的
`public/data/*.json`（由 Vite `publicDir` 指向 `../public`，路径是
`chrome.runtime.getURL('data/…')` 的 mock 结果）。

## 四种场景

顶部工具栏一行切换，URL 会同步成 `?scene=…&v=…`，可以直接分享/刷新某场景：

| 场景 | `?scene=` | 行为 |
| --- | --- | --- |
| 正常 | `normal` | 完整双语流程；第 7 句首次翻译**故意失败**，点侧栏「重试」恢复；fixture 中后段还有已翻译句、未译句与失败句 |
| 无字幕 | `no-captions` | 模拟 `earworm:cues-failed`（`no-captions`）：overlay 显示「无字幕」提示，侧栏为空 |
| 翻译失败 | `translate-failed` | 第一批 `translate-batch` 返回错误：14 句全失败、只显示英文，可「全部重试」或逐句重试恢复 |
| 缓存命中 | `cache-hit` | 预先写入与 fixture 匹配的 `CachedTranslation`：`get-cached` 直接命中，0 次翻译请求 |

每个场景使用不同的 mock `videoId`，切换时走真实的 SPA 导航路径（`history` +
`yt-navigate-finish`），因此 T3 的 transcript client 与 T13 的 session 会真的重新初始化，
状态切换不是 playground 伪造的。工具栏实时显示 mock 统计：
`缓存命中 x/y · 翻译请求 n · 提交 n`。

## 可以试的交互

- **播放 / 暂停**：播放器控制条或点击画面；进度条可点击/方向键 seek。
- **`a` / `s` / `d`**：上一句 / 重复当前句 / 下一句。默认句尾暂停，`连续播放`复选框
  写入真实的 `playback.continuous` 设置，再按 `d` 会连续播过句尾。
- **侧栏**：当前句琥珀色高亮；点击任意句跳转并播放；失败句有「重试」；顶部有全局重试。
- **模糊**：播放器左上角「模糊」开关，分别控制 `ui.blur.en` / `ui.blur.zh`。
- **点词词典**：点击英文字幕里的单词，弹出真实 ECDICT 条目（音标 / 词性 / 考试标签 /
  中文释义），命中搭配时先显示搭配卡片（如 `in the dictionary`）。Esc、滚动或页面点击关闭。
- **场景按钮**：正常 / 无字幕 / 翻译失败 / 缓存命中，一屏内切换，滚动位置自动回到顶部。
- **重新加载**：整页刷新，用来验证冷启动 / 缓存恢复。

键盘快捷键要求页面本身有焦点（点一下页面即可）；输入框内不会触发。

## 调试入口

页面在 `window.__earwormPlayground` 暴露：

```ts
{
  backend,   // MockBackend：cache / stats / seedCache / handleMessage
  player,    // MockVideoHandle：state() / seek() / play() / pause() / subscribe()
  scene,     // () => 当前 SceneDefinition
  switchScene(sceneId),
  dispose(),
}
```

浏览器控制台可直接操作，例如：

```js
__earwormPlayground.backend.snapshot();
__earwormPlayground.player.seek(12);
__earwormPlayground.switchScene('cache-hit');
```

## 实现结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 仿 YouTube 观看页骨架：`#movie_player` + `video.html5-main-video`、`.ytp-chrome-bottom` 控制条、`#secondary` 推荐位、`#dev-toolbar` |
| `main.tsx` | 引导：安装 mock → 挂载调试工具栏 → 预载词库/搭配 → 调用真实 `mountContentApp({ css })`；暴露调试入口；处理 popstate 与清理 |
| `scene.ts` | 场景定义、`?scene`/`?v` 解析与同步、`yt-navigate-finish` 导航 |
| `fixture.ts` | 14 句 fixture（cue / 英文 / 中文 / 搭配），以及缓存 payload 构造 |
| `mock/clock.ts` | 纯时钟 `MockPlayhead`：播放/暂停/seek/推进，不依赖浏览器 |
| `mock/video.ts` | 把 `MockPlayhead` 装到真实 `<video>` 实例属性上（`currentTime`/`paused`/`duration`/`play`/`pause`），rAF 推进并派发 `play`/`timeupdate`/`ended`；绑定控制条与点击 seek |
| `mock/background.ts` | mock `runtime.sendMessage` 的四类请求：`get-cached` / `translate-batch` / `commit` / `test-llm`（另含 `clear-cache`），带内存缓存、可复现的失败与延迟、统计订阅 |
| `mock/chrome.ts` | mock `chrome.storage.local`（含 `onChanged`，镜像到 `sessionStorage`）、`runtime.getURL`、`runtime.sendMessage`、`permissions` |
| `mock/inject.ts` | mock MAIN-world 字幕生产端：监听 `earworm:produce`，按场景回 `earworm:cues-ready` / `earworm:cues-failed` |
| `toolbar.tsx` | 调试工具栏（场景按钮、连续播放、统计、重新加载），使用真实 settings API |
| `vite.config.ts` | Vite root / publicDir / `@` alias / Tailwind 插件 / 端口等 |
| `smoke.ts` | 不启动浏览器的冒烟检查（fixture 合并、时钟、mock background、场景 URL） |

挂载路径与扩展一致：`mountContentApp` → `createShadowUi`（body 下 `<earworm-root>` 的
open shadow root + Tailwind style）→ 真实 `AppProviders` → 真实 `ContentApp`。因此字幕定位、
侧栏停靠、模糊、词典 portal 都在真实的 shadow DOM 中运行。

两条 mock 边界：

1. **chrome API**：`mock/chrome.ts` 在 `mountContentApp` 之前安装到 `globalThis.chrome`；
   存储写入同时镜像到 `sessionStorage`，刷新后设置仍在（清掉
   `earworm:playground:storage` 可重置）。
2. **播放器 / 字幕**：真实 `<video class="html5-main-video">` 元素的 `currentTime` 等属性被
   mock 覆盖；字幕生产端通过 `window.postMessage` 回包，session 与 `playerController`
   完全按生产逻辑消费。

## 检查命令

```bash
pnpm exec tsx playground/smoke.ts        # 16 项 mock / fixture 冒烟断言
pnpm typecheck                           # 包含 playground/（tsconfig include）
pnpm test                                # 仅 src + tests，不受 playground 影响
pnpm build                               # WXT 扩展构建，不受 playground 影响
pnpm exec vite build --config playground/vite.config.ts   # 单独构建 playground 静态页
```

playground 构建产物在 `playground/dist/`（已在 `.gitignore` 的 `dist/` 规则内）。

## HMR / 刷新行为

`pnpm playground` 是标准的 Vite dev server，改动会自动生效，不需要重启进程。
注意：真实 ContentApp 的样式来自 Tailwind `@source` 扫描的 `src/` 模块，**改动 `.tsx` /
样式相关文件时 Tailwind 会重新编译整张 shadow-root 样式表，Vite 因此整页刷新**（页面状态
会重置）。这是本仓库样式表与 Vite 的既有行为；数据、mock 与实际扩展构建不受影响。
修改 `playground.css` 等直接链接的样式同样会整页刷新。

## 已知限制

- 不是 e2e 测试：只验证 mock 边界与真实组件能一起运行，交互正确性由 `src/` 的 Vitest
  测试覆盖。
- 不模拟 YouTube 登录、广告、剧场模式、原生字幕 OCR；剧场/全屏相关分支按「关」处理。
- `crypto.subtle` 需要安全上下文：请用 `http://localhost` / `127.0.0.1` 访问；用局域网 IP
  访问时缓存 key 无法计算，`get-cached` 会失败（页面会显示错误横幅）。
- fixture 是固定的 14 句，时长约 44 秒；拖动到更后面没有新字幕。
- `tests/` 与 `vitest.config.ts` 不在本目录范围内：`smoke.ts` 用独立脚本运行，避免把
  playground 加进扩展的单测入口。

## 故障排查

- 端口不是 5183：看终端打印的实际地址，或在 `vite.config.ts` 修改 `server.port`。
- 页面空白：打开控制台看 `/main.tsx` 或 `@/...` 解析错误；本仓库需要先
  `pnpm install --frozen-lockfile`。
- 设置/缓存与预想不一致：清空 `sessionStorage` 的 `earworm:playground:storage`，或在工具栏
  点「重新加载」；缓存命中场景是每次启动预置的。
- 词典不弹：确认点击的是英文 overlay 单词、`public/data/ecdict.json` 存在且
  `http://localhost:5183/data/ecdict.json` 返回 200。
