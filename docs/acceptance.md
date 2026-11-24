# 验收清单（T16 / issue #17，spec §7）

- 验收对象：`integration/earworm-v1` + `ticket/16`（T1–T15；T14 playground 独立目录，不影响扩展验收）。
- 自动化基线：`pnpm typecheck`、`pnpm test`、`pnpm build`、`node scripts/audit-attribution.mjs` 全绿。
- 手工验收环境：Chrome/Edge（Manifest V3）、Node ≥ 22、本机 magpie 网关
  `http://127.0.0.1:3425/v1`（模型 `group/free-ds`）。
- 本文的「实际结果」栏留给人工填写；自动化已覆盖的项也在对应步骤标注证据。

## 1. 构建与加载

```bash
pnpm install --frozen-lockfile
pnpm typecheck        # wxt prepare + tsc --noEmit
pnpm test             # Vitest：无网络，happy-dom
pnpm build            # 产物 .output/chrome-mv3
node scripts/audit-attribution.mjs
```

加载步骤：

1. 运行 `pnpm build`（或 `pnpm dev` 自动加载）。
2. Chrome/Edge 打开 `chrome://extensions`，开启右上角「开发者模式」。
3. 「加载已解压的扩展程序」→ 选择仓库下的 `.output/chrome-mv3`。
4. 打开「扩展选项」确认 LLM 端点：`http://127.0.0.1:3425/v1`、模型 `group/free-ds`、
   API key（如 magpie 需要）。默认值已与本机 magpie 对齐。
5. 确认 magpie 正在运行（`curl -s http://127.0.0.1:3425/v1/models` 应返回模型列表）。

### 离线 playground（可选预验收，不联网）

在真实 YouTube 验收前，可先用 T14 的离线 playground 检查完整 UI 与交互；它挂载的是
真实的 `ContentApp`，只 mock 了 `chrome.*`、播放器和字幕/翻译后端：

```bash
pnpm playground                 # 打开终端打印的地址，默认 http://localhost:5183/
pnpm exec tsx playground/smoke.ts                          # 16 项 mock / fixture 冒烟
pnpm exec vite build --config playground/vite.config.ts    # playground 单独构建
```

顶部工具栏可切换 `normal` / `no-captions` / `translate-failed` / `cache-hit` 四种场景，
覆盖正常双语、无字幕、翻译失败重试与缓存命中零请求。详细用法见
[`playground/README.md`](../playground/README.md)。

实际结果：____________________

### 构建产物检查（自动 + 人工）

`node scripts/verify-manifest.ts`（`pnpm build` 已调用）与 `tests/manifest.test.ts`
断言以下内容；也可打开 `.output/chrome-mv3/manifest.json` 人工核对：

| 项 | 期望 |
| --- | --- |
| `content_scripts[0]` | `inject.js`，`run_at: document_start`，`world: MAIN`，仅 `https://www.youtube.com/*` |
| `content_scripts[1]` | `content-scripts/content.js`，`run_at: document_idle` |
| `background.service_worker` | `background.js` |
| `options_ui.page` | `options.html`（`open_in_tab: true`） |
| `web_accessible_resources` | `data/*` 对 YouTube 可用 |
| 权限 | `permissions: ["storage"]`；host 仅 localhost/127.0.0.1；其余为 optional host |
| `inject.js` | 不含 `chrome.` 引用（MAIN world 无 chrome API） |
| 归属文件 | 产物根目录含 `LICENSE`、`NOTICE`（WXT `build:publicAssets` 复制） |

实际结果：____________________

## 2. 测试视频候选

> YouTube 的字幕可用性会变化，验收前请先确认视频 CC 菜单有「English (manually
> created)」；若候选失效，换任意同类型视频并在结果栏记录实际 URL。

| 用途 | 候选 URL | 预期 |
| --- | --- | --- |
| 主视频（长演讲，人工英文字幕） | https://www.youtube.com/watch?v=UF8uR6Z6KLc | 有 manual English CC；句子多、适合导航与逐句列表 |
| 第二视频（TED 演讲，术语/专有名词） | https://www.youtube.com/watch?v=Ks-_Mh1QhMc | 有 manual English CC；用于译文质量抽查 |
| Shorts（可选，v1 支持） | 在 YouTube 搜索 `TED shorts`，选一条带 CC 徽标的 Shorts | Shorts 播放器内 overlay 使用 18% 底部锚点，不遮挡右侧操作栏 |
| 无字幕视频 | https://www.youtube.com/watch?v=jfKfPfyJRdk | 若该直播已提供自动字幕，请改选 CC 菜单无英文的纯音乐/环境音视频；预期显示「无字幕」且播放正常 |

实际使用的视频 URL：____________________

## 3. spec §7 逐项验收

### §7.1 侧栏双语 / 高亮 / 点击跳转

自动证据（`pnpm vitest run tests/acceptance.test.tsx`）：

- `merges cues, shows offline spans before translation, then bilingual overlay + sidebar`
  —— 注入 cues → 合并成句 → 侧栏/overlay 双语，侧栏行内含 `data-collocation` 高亮。
- `opens the dictionary popup for a clicked word with its collocation card` —— 点词链路。
- `resets and re-acquires on YouTube SPA navigation` —— SPA 切换后侧栏重建。

手工步骤：

1. 打开主视频，播放 10 秒后暂停。
2. 侧栏应出现逐句列表：英文 + 中文，两行都可见；中文未返回时显示「翻译中…」。
3. 当前句随播放高亮（琥珀色左边框），列表自动滚动。
4. 点击第 5 句，视频应跳到该句开头并继续播放。
5. 搭配（如视频中出现 `give up`、`look forward to`）在侧栏与 overlay 中有底色高亮。

实际结果：____________________

### §7.2 a/s/d、连续播放、焦点让行

自动证据：

- `navigates with a / s / d and lets editable focus keep the keys` —— `d` 跳下一句并
  `playRange(..., {pauseAtEnd:true})`；`a` 回到上一句；侧栏「连续播放」开关切换后
  `pauseAtEnd:false`；聚焦 `<input>` 时按键不触发跳转。

手工步骤：

1. 默认连续播放关闭：按 `d`，应只播放下一句并在句尾暂停；再按 `s` 重播本句；
   按 `a` 回上一句（第一句时停在第一句）。
2. 侧栏头部打开「连续播放」开关（或设置页打开默认连续播放）：按 `d` 后应连续播放，
   不在句尾暂停。
3. 点开视频评论框输入 `asd`，不应触发任何跳转；Esc 退出输入后再按 `d` 恢复。

实际结果：____________________

### §7.3 点词弹窗（音标 + 释义 + 搭配）

自动证据：`opens the dictionary popup for a clicked word with its collocation card`
—— 弹窗 headword/phonetic/translation、搭配条目与 note 均来自真实 `DictionaryPopup`
与 `SentenceText`，仅 `lookupWord` 数据源被 mock。

手工步骤：

1. 在侧栏或 overlay 点击一个普通单词（如 `give`）：弹窗显示音标、词性、中文释义；
   变形词（如 `running`）应还原到 `run` 后查询。
2. 点击搭配中的词（如 `give up`）：弹窗额外显示搭配条目「give up / 放弃」。
3. 点击弹窗外部：弹窗关闭；点击另一个词：内容替换而不是叠加。

实际结果：____________________

### §7.4 离线先高亮、LLM span 叠加且不重复

自动证据：`merges cues, shows offline spans before translation, then bilingual overlay + sidebar`
—— 翻译请求被 deferred 时，`mark[data-collocation="offline"]` 已存在于 overlay 与侧栏；
翻译返回后同一句只剩一个 `mark[data-collocation="llm"]`，无重复渲染。

手工步骤（可选，本地 LLM 很快时用 DevTools 阻塞请求观察）：

1. 打开视频后立刻看侧栏：中文出现前，搭配已有淡色高亮（离线表）。
2. DevTools → Network → 对 `127.0.0.1:3425` 设 request blocking，刷新视频：
   离线高亮仍在，中文行显示「翻译失败」+「重试」。
3. 取消 blocking，点「重试」（或侧栏「全部重试」）：中文出现，高亮变为 LLM 搭配，
   同一短语不应出现双层或重复底色。

实际结果：____________________

### §7.5 英 / 中 blur 独立、overlay 与侧栏同步、悬停显现

自动证据：`toggles English and Chinese blur independently through the shadow UI`
—— 两个开关独立切换根节点 `data-blur-en/zh`，英文文本 computed `filter: blur(5px)`，
中文独立；CSS 同时匹配 overlay 与侧栏的 `[data-lang]`。

手工步骤：

1. 打开 overlay 左上角「模糊」控件，只开「英」：overlay 与侧栏英文变模糊，中文清晰。
2. 再开「中」：中文也模糊；关闭「英」：仅中文模糊。
3. 悬停任一模糊行（或键盘 focus 行内单词）：该行临时清晰，移开恢复模糊。
4. 刷新页面：开关状态来自设置，保持一致。

实际结果：____________________

### §7.6 请求打到配置端点 + 译文抽查

自动证据：

- `tests/acceptance.test.tsx` 断言 content → background 的
  `earworm:translate-batch` 请求包含 `videoId`、64 位 `cuesHash`、`meta.title` 与
  逐句 `{i, text, prev?}`；端点/鉴权由 background 配置（`tests/llm-*.test.ts` 覆盖）。
- `pnpm test` 中的 options/settings 测试覆盖默认端点 `http://127.0.0.1:3425/v1`、
  模型 `group/free-ds` 与 host 权限申请。

手工步骤：

1. 打开 magpie 日志/状态页（默认 `http://127.0.0.1:3425`），或看 magpie 终端输出。
2. 首次打开主视频：应看到一批 `POST /v1/chat/completions`，模型名为 `group/free-ds`。
3. 抽查第二视频中含专有名词的 5–10 句译文：应为自然中文，不出现逐词直译；
   专有名词保持约定译名或原文。
4. 扩展选项页的 baseUrl/model 与实际请求一致；API key 不出现在 URL/日志中。

实际结果：____________________

### §7.7 无英文字幕视频

自动证据：`shows 无字幕 without requesting translation and leaves playback alone`
—— 注入 `cues-failed(no-captions)` 后 UI 显示「无字幕」，不发送翻译请求，不调用
`video.pause()`。

手工步骤：

1. 打开无字幕候选视频（或任意 CC 菜单无英文的视频）。
2. overlay/侧栏显示「无字幕」，无持续报错、无重试风暴。
3. 视频可正常播放/暂停/拖动进度；扩展不写入错误缓存。

实际结果：____________________

### §7.7.1 屏上字幕兜底（best-effort，spec §5）

自动证据：`synthesizes cues from painted screen text when nudging cannot be sniffed`
—— nudge 超时后，注入脚本在 4s 窗口内采样 `.ytp-caption-segment` 文本，
以 `video.currentTime` 合成 `kind: 'manual'` 的 `cues-ready`；有真实 timedtext
捕获时立即中止采样（`lets a real timedtext capture win over the screen-text fallback`）。

兜底限制（已知，不在 v1 修复范围）：

- 只读取采样时**正在屏幕上绘制**的字幕行；暂停、原生字幕未开启或纯空白窗口
  读不到文本，仍回落到原有分类失败（`nudge-failed` / `timeout`）。
- 合成 cue 的 `start` 是采样墙钟时间，不是 YouTube 的真实 cue 起点；`end` 取
  下一行出现时间（末行固定 +2s），因此时间轴精度低于 `timedtext` 路径。
- 兜底不改变「v1 只接受人工英文字幕」：ASR-only / 无英文轨仍直接分类失败，
  不抓屏上文本。

手工步骤：对一个 CC 菜单有 manual English、但注入脚本抓不到 timedtext 的视频，
确认 15s 内（8s 嗅探 + 3s nudge + ≤4s 采样）出现双语字幕；若窗口内无屏上文本，
overlay 显示「字幕获取失败」并可点「重试」。

实际结果：____________________

### §7.8 同视频二次打开零 LLM 请求

自动证据：`reuses the cache on the second open with zero translate requests`
—— 第一次打开产生 1 次 translate-batch + 1 次 commit；卸载后重新挂载同一视频，
`translateCalls` 仍为 1，翻译直接来自 `get-cached` 命中。

手工步骤：

1. 清空 magpie 日志计数，打开主视频，等到侧栏全部中文出现。
2. 关闭标签页（不要清扩展存储），重新打开**同一 URL**。
3. 期望：侧栏/overlay 立即显示双语（缓存命中），magpie 无新的 chat/completions 请求。
4. 换一个视频再打开：应有新的 LLM 请求（证明不是全局禁用翻译）。

实际结果：____________________

### §7.9 MIT / CC-BY 归属

自动证据：

- `pnpm vitest run tests/manifest.test.ts` →
  `ships attribution and keeps the MAIN-world inject script chrome-free`
  —— 产物含 `LICENSE`、`NOTICE`，`inject.js` 无 `chrome.`。
- `node scripts/audit-attribution.mjs` —— 66 项检查：adapted 文件头、NOTICE 全文、
  CC-BY 署名、无 GPL/AGPL 文本。

手工步骤：

1. 打开 `.output/chrome-mv3`，确认根目录有 `LICENSE` 与 `NOTICE`。
2. 抽查 `src/entrypoints/inject.ts`、`src/features/overlay/Overlay.tsx`、
   `src/features/sidebar/Sidebar.tsx` 顶部：保留
   `Adapted for Earworm (MIT) from ... — Copyright ...` 与 NOTICE 指针。
3. `NOTICE` 应包含 yt-dual-subs、easysubs、SceneLingo、shadcn/ui 的 MIT 文本，以及
   ECDICT（MIT）与 OpenSubtitles 搭配表（CC-BY 4.0，Lison & Tiedemann 2016）的署名。
4. `public/data/collocations.json` 的 `meta.license` 应为 `CC-BY-4.0`，含
   `meta.attribution` 与 `meta.sourceUrl`。

实际结果：____________________

## 4. 边界与回归抽查（建议）

| 场景 | 预期 | 实际结果 |
| --- | --- | --- |
| YouTube SPA：首页 → 视频 → 另一个视频 | 旧字幕不残留；新视频重新载入；无重复 overlay | ______ |
| 关闭再打开侧栏 | 开关状态持久化；列表恢复 | ______ |
| 扩展重新加载（chrome://extensions） | 页面需刷新；刷新后正常挂载，无重复 shadow root | ______ |
| 视频无中文译文（LLM 失败） | 英文仍显示；失败句可单句重试；其余句不受影响 | ______ |
| Shorts（可选） | overlay 在 18% 底部锚点，不被右侧按钮遮挡；退出 Shorts 恢复普通锚点 | ______ |
| 原生字幕 | 会话 ready 且显示双语字幕时 YouTube 原生字幕视觉消失；无字幕/获取失败时不隐藏，禁用扩展或离开 YouTube 后恢复 | ______ |

## 5. 测试限制（必读）

- 自动化测试完全不联网：`chrome.runtime`、离线数据文件、词典查询均被 mock；
  真实的 YouTube 页面、字幕接口、magpie 请求与视觉布局必须由本文手工步骤覆盖。
- happy-dom 的 `window.postMessage` 不设置 `MessageEvent.source`，而生产桥接会拒绝
  非同源窗口消息；`tests/acceptance.test.tsx` 用真实 `postCuesReady` 生成 envelope 后
  以 `source: window` 派发，因此覆盖了真实校验逻辑与客户端，但不覆盖浏览器
  `postMessage` 传输本身（该传输由单测与真实手工验收覆盖）。
- 原生字幕 `aria-hidden`：测试只断言 DOM 属性与清理恢复，未用真实屏幕阅读器验证。
- 屏上字幕兜底只在合成 DOM/定时器上测试，真实 YouTube 的 caption DOM 改版或
  虚拟化渲染未覆盖；限制见 §7.7.1。
- Shorts 几何为合成矩形断言（`#shorts-player` + 18% 锚点），未在真实 Shorts DOM 上
  做截图比对；若 YouTube 改版，需手工确认。
- 候选视频的字幕可用性可能随 YouTube 变化；以实际 CC 菜单为准。
- 缓存测试在 content session 层使用内存 harness 证明「零翻译请求」；真实 IndexedDB
  缓存由 background 单测覆盖，手工步骤 8 再加一层端到端确认。

## 6. 结果汇总

| 项 | 自动 | 手工 | 结论 / 备注 |
| --- | --- | --- | --- |
| §7.1 双语/高亮/点击 | PASS | ______ | |
| §7.2 a/s/d/连续/焦点 | PASS | ______ | |
| §7.3 点词弹窗 | PASS | ______ | |
| §7.4 离线→LLM 高亮 | PASS | ______ | |
| §7.5 blur | PASS | ______ | |
| §7.6 端点/译文 | PASS（请求契约） | ______ | 译文质量需人工 |
| §7.7 无字幕 | PASS | ______ | |
| §7.8 二次打开零请求 | PASS | ______ | 需 magpie 日志确认 |
| §7.9 归属 | PASS | ______ | |

最终结论：____________________　验收人：__________　日期：__________
