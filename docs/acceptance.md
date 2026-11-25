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

> YouTube 的字幕可用性会变化，验收前请先确认视频 CC 菜单有 English（人工或自动）；
> 若候选失效，换任意同类型视频并在结果栏记录实际 URL。

| 用途 | 候选 URL | 预期 |
| --- | --- | --- |
| 主视频（长演讲，人工英文字幕） | https://www.youtube.com/watch?v=UF8uR6Z6KLc | 有 manual English CC；句子多、适合导航与逐句列表 |
| 第二视频（TED 演讲，术语/专有名词） | https://www.youtube.com/watch?v=Ks-_Mh1QhMc | 有 manual English CC；用于译文质量抽查 |
| 人工 + ASR 并存（TED） | https://www.youtube.com/watch?v=iG9CE55wbtY | 同时有 manual English 与自动英文字幕；扩展仍选人工轨（§7.10） |
| ASR-only 视频（自动英文字幕兜底） | https://www.youtube.com/watch?v=ZedAs9P7yE8 | 仅 auto-generated English (ASR) 轨；应出句列表与双语字幕，按停顿/词数成句（§7.10） |
| Shorts（可选，v1 支持） | 在 YouTube 搜索 `TED shorts`，选一条带 CC 徽标的 Shorts | Shorts 播放器内 overlay 使用 18% 底部锚点，不遮挡右侧操作栏 |
| 无字幕视频 | https://www.youtube.com/watch?v=jfKfPfyJRdk | 若该直播已提供自动字幕，请改选 CC 菜单无英文的纯音乐/环境音视频；预期显示「无字幕」且播放正常 |

实际使用的视频 URL：____________________

## 3. spec §7 逐项验收

### §7.1 侧栏双语 / 高亮 / 点击跳转

自动证据（`pnpm vitest run tests/acceptance.test.tsx`）：

- `merges cues, shows offline spans before translation, then bilingual overlay + sidebar`
  —— 注入 cues → 合并成句 → 侧栏/overlay 双语，侧栏行内含 `data-collocation` 高亮；
  同时断言侧栏宿主是 `#secondary-inner` 的首个子节点、推荐视频在其后、面板为
  `data-mode="docked"` 且无 `position: fixed`。
- `opens the dictionary popup for a word clicked inside the docked sidebar`
  —— 嵌套 shadow root 内点词仍打开主 shadow root 的词典弹窗。
- `keeps the docked sidebar in a replaced recommended column`
  —— 右栏重建后宿主重新插入新列首位。
- `resets and re-acquires on YouTube SPA navigation` —— SPA 切换后侧栏重建。
- `src/features/sidebar/sidebar.test.tsx` 的 `sidebar placement`
  —— 宿主插入位置、面板 `56vh`（320–560px）定高、列表 `overflow-y-auto` 独立滚动、
  折叠后宿主移除/推荐视频上移、全屏转抽屉、blur 属性同步到宿主。
- `src/features/sidebar/selectors.test.ts`
  —— 布局环境只含 `hasSecondary`/`viewportWidth`/`fullscreen`；给播放器加
  `ytp-large-width-mode`（剧场）不改变环境，剧场不再参与布局判定。

手工步骤：

1. 打开主视频，播放 10 秒后暂停。
2. 侧栏应插入右栏文档流顶部（`#secondary` 区域），推荐视频位于面板**下方**，
   不覆盖、不悬浮。
3. 页面下滑时侧栏随页面正常滚走（不是 fixed/sticky 悬浮）；面板内列表独立滚动，
   当前句高亮随播放自动滚动，滚动列表不应带动整页。
4. 侧栏应出现逐句列表：英文 + 中文，两行都可见；中文未返回时显示「翻译中…」。
5. 当前句随播放高亮（琥珀色左边框），列表自动滚动。
6. 点击第 5 句，视频应跳到该句开头并继续播放。
7. 搭配（如视频中出现 `give up`、`look forward to`）在侧栏与 overlay 中有底色高亮。
8. 点右上「收起字幕侧栏」：面板消失、推荐视频上移；浮出的「字幕」按钮可重新展开。
9. 进入全屏：侧栏转为右侧抽屉；退出全屏后回到右栏文档流。
10. 切换视频（SPA）：侧栏应出现在新视频的右栏顶部，不残留旧视频句子。
11. 剧场模式：右栏可用则插入其中（文档流），不可用则右侧抽屉。该模式不再单独触发
    任何特殊布局；宽/窄窗口的差异完全来自 YouTube 是否暴露可用的 `#secondary`。

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
中文独立；同时断言右栏嵌套宿主的 `data-blur-en/zh` 与开关同步，嵌套样式表包含
`:host([data-blur-en="1"]) [data-lang="en"]` 规则（overlay 与侧栏共用 `[data-lang]`）。
嵌套树内的实际 computed style 受 happy-dom 限制，需手工确认。

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

自动证据：

- `synthesizes cues from painted screen text when nudging cannot be sniffed`
  —— nudge 超时后，注入脚本在 4s 窗口内采样 `.ytp-caption-segment` 文本，
  以 `video.currentTime` 合成 `kind: 'manual'` 的 `cues-ready`；有真实 timedtext
  捕获时立即中止采样（`lets a real timedtext capture win over the screen-text fallback`）。
- `marks synthesized screen-text cues as ASR when the nudge chose an ASR track`
  —— nudge 选中的是 ASR 轨时，同样的屏上文本合成 `kind: 'asr'`，下游按 ASR
  停顿/词数规则成句。

兜底限制（已知）：

- 只读取采样时**正在屏幕上绘制**的字幕行；暂停、原生字幕未开启或纯空白窗口
  读不到文本，仍回落到原有分类失败（`nudge-failed` / `timeout`）。
- 合成 cue 的 `start` 是采样墙钟时间，不是 YouTube 的真实 cue 起点；`end` 取
  下一行出现时间（末行固定 +2s），因此时间轴精度低于 `timedtext` 路径。
- 合成 cue 的 `kind` 跟随失败路径已确定的轨：nudge 选中 ASR 轨 → `asr`；
  人工轨或轨道未知 → `manual`。ASR-only 不再直接分类失败（v1 接受 ASR 兜底）。

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

### §7.10 ASR-only 视频（自动英文字幕兜底，spec §7 第 10 条）

自动证据：

- `tests/acceptance-asr.test.tsx` →
  `splits ASR cues on pauses, shows bilingual rows and navigates a/s/d`
  —— 以真实 `postCuesReady` envelope（`kind: 'asr'`）注入无标点 cues：0.8s 停顿处
  断句、0.5s 停顿处合句，侧栏两行双语、overlay 双语，`a`/`s`/`d` 在 ASR 句列表上
  跳转/复读并在句尾暂停。
- `src/lib/cues/merge.test.ts`（ASR describe）—— 0.8s 停顿阈值、20 词硬上限
  （超长单个 fragment 按词切块、时间连续、结尾标点只留最后一块）、标点优先、
  自定义 `pauseSeconds`/`maxWords`，以及 manual 轨默认行为不变。
- `tests/inject-runtime.test.ts` —— 嗅探 `kind=asr&lang=en` 捕获并以 `kind: 'asr'`
  发送；非英文 ASR 捕获仍被忽略；nudge 用 `{languageCode, kind: 'asr', vssId}`
  精确选 ASR 轨；屏上文本兜底 cue 带 `kind: 'asr'`；人工 + ASR 并存时先到的 ASR
  捕获被忽略并推人工轨，人工轨已捕获后后续 ASR 捕获不再改写来源、不重复 fetch。
- `tests/transcript-url.test.ts` —— ASR-only 列表选 ASR 轨；manual + ASR 并存仍选
  人工轨；非英文 ASR 不当作英文轨。

手工步骤：

1. 打开 ASR-only 候选 https://www.youtube.com/watch?v=ZedAs9P7yE8（Dave2D）。
   CC 菜单应只有自动生成的 English（auto-generated），无 manual 轨。
2. 等待 ≤15s：侧栏出现逐句列表 + 双语字幕；句子按停顿（≥0.8s）或 20 词硬上限
   断开（单个超长 fragment 会被切块），不是每条原始 cue 一行；overlay 英上中下。
3. 按 `a` / `s` / `d`：上一句 / 重复当前句 / 下一句均按 ASR 合并后的句子跳转，
   默认句尾暂停；打开连续播放后不暂停。
4. 打开人工 + ASR 并存候选 https://www.youtube.com/watch?v=iG9CE55wbtY（TED）：
   CC 菜单同时有人工与自动英文字幕；扩展仍选人工轨（Network 面板中 timedtext
   请求的 `kind` 为空/manual，而非 `kind=asr`；句子边界应符合标点规则）。
5. 打开无英文轨视频：仍显示「无字幕」，见 §7.7。

已知限制：

- 停顿规则依赖清洗后相邻 cue 的真实 gap。YouTube ASR 的 cue 常首尾相接（下一句
  开始时间就是上一句结束时间），此时 0.8s 停顿很少出现，20 词上限才是主要的兜底
  断句依据；句子粒度因此可能偏长，但不会超过 20 词。
- 20 词是硬上限而非仅在 cue 边界断句：单个超长 fragment 会按词切成 ≤20 词的块，
  时间按字符占比分配，只有最后一块保留原结尾标点，因此一条原始 cue 可能被拆成
  多行（每块各自成句）。
- 根因说明（供 issue #30 关闭评论引用）：ASR 的 timedtext 捕获能力在 v1 早期就已
  存在，只是当时按 manual-only 范围决策被主动丢弃；后续恢复它是范围调整，不是
  修复「ASR 获取故障」。本次改动只处理人工 + ASR 并存时的优先级。

实际结果：____________________

## 4. 边界与回归抽查（建议）

| 场景 | 预期 | 实际结果 |
| --- | --- | --- |
| YouTube SPA：首页 → 视频 → 另一个视频 | 旧字幕不残留；新视频重新载入；无重复 overlay；侧栏宿主重插新 `#secondary-inner` 首位 | ______ |
| 右栏整体重建（推荐视频刷新） | `earworm-sidebar-host` 仍在当前列首位，推荐视频在面板下方，不出现重复面板 | ______ |
| 关闭再打开侧栏 | 开关状态持久化；宿主移除后推荐视频上移；重开后列表恢复 | ______ |
| 剧场模式 | 不再特殊处理：右栏可用则插入其中（文档流），不可用则右侧抽屉 | ______ |
| 进入 / 退出全屏 | 进入全屏转右侧抽屉并移走嵌套宿主；退出后回到右栏文档流 | ______ |
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
- happy-dom 不实现布局与真实滚动：右栏侧栏的「文档流位置、推荐视频在其下方、
  面板定高 + 列表独立滚动、页面下滑侧栏滚走、与 YouTube 列样式的贴合」只能由
  DOM 结构/样式断言与本文手工步骤覆盖。宿主插入 `#secondary-inner` 首位、
  SPA 重插、折叠/全屏切换、blur 属性同步有自动化断言。
- happy-dom 对嵌套 shadow root 的 `:host([data-blur-*])` 属性变更不会使深层子树
  的 computed style 失效；侧栏 blur 因此以「宿主属性 + 注入的 `:host` 选择器
  CSS」断言，实际模糊效果需按 §7.5 手工确认。
- 原生字幕 `aria-hidden`：测试只断言 DOM 属性与清理恢复，未用真实屏幕阅读器验证。
- 屏上字幕兜底只在合成 DOM/定时器上测试，真实 YouTube 的 caption DOM 改版或
  虚拟化渲染未覆盖；限制见 §7.7.1。
- 真实 YouTube ASR 轨未在自动化中验收：`tests/acceptance-asr.test.tsx` 从真实的
  `cues-ready(kind:'asr')` bridge 消息开始，覆盖 ASR 成句/双语/a/s/d/契约；真实 ASR
  timedtext 嗅探、nudge 选中 ASR 轨与屏上文本兜底需按 §7.10 手工确认。
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
| §7.10 ASR-only 兜底 | PASS | ______ | 真实 ASR 轨需手工（Dave2D）；TED 应仍选 manual |

最终结论：____________________　验收人：__________　日期：__________
