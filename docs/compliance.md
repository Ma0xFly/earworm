# 归属合规审计（T15 / issue #16）

审计日期：2026-11-24
审计基线：`integration/earworm-v1` @ `6acfab6`（T1–T12 除 T13）
分支：`ticket/15`

本审计覆盖 Earworm v1 中 copy/adapt 的代码、prompt 与随扩展分发的数据，目标是
ADR-0004 的「只 copy MIT 源，GPL/AGPL 只借鉴思路」以及 spec §4/§7.9 的 MIT /
CC-BY 归属要求。审计是只读的，不修改业务逻辑。

## 方法与复现

仓库内提供可重复执行的审计脚本：

```bash
node scripts/audit-attribution.mjs          # 在仓库根运行；也可传入仓库路径
```

脚本检查：

1. 18 个 adapted 文件的顶部注释包含
   `Adapted for Earworm (MIT) from <repo> (<license>) — Copyright (c) <year> <author>`，
   且 repo 与 copyright 行和来源匹配；
2. `src/`、`scripts/`、`tests/` 中任何提到上游名称的文件都有对应版权头，
   防止「提到来源但没加头」的漏网文件；
3. 明确判定为原创的审查文件没有误加第三方头；
4. 源码与 `docs/` 中没有 GPL/AGPL 许可全文或 SPDX GPL/AGPL 声明（ADR 中的
   项目名讨论除外，见下）；
5. `LICENSE` 为 MIT；`NOTICE` 包含全部来源、版权行、CC-BY 4.0、OpenSubtitles
   引用与 MIT 许可全文；`README.md` 包含数据来源与两条重建命令；
6. `public/data/collocations.json` 的 `meta` 仍带 CC-BY 4.0 / OpenSubtitles /
   Lison & Tiedemann 署名；
7. 所有带 `Adapted for Earworm` 头的文件都在审计表内。

本次输出：**66 项检查全部通过**。完整输出已作为 issue #16 评论保存。

## 代码审计表

| # | 文件 | 来源 | 许可 | 版权头 |
|---:|---|---|---|---|
| 1 | `src/entrypoints/inject.ts` | Gythiro/yt-dual-subs 3.7.0（inject.js） | MIT | OK |
| 2 | `src/lib/transcript/bridge.ts` | yt-dual-subs（inject.js / content.js bridge） | MIT | OK |
| 3 | `src/lib/transcript/client.ts` | yt-dual-subs（content.js client / SPA） | MIT | OK |
| 4 | `src/lib/transcript/parse.ts` | yt-dual-subs（parseJson3 / computeCueEnds） | MIT | OK |
| 5 | `src/lib/transcript/url.ts` | yt-dual-subs（URL / track selection） | MIT | OK |
| 6 | `src/lib/llm/client.ts` | yt-dual-subs（background.js translation channel） | MIT | OK |
| 7 | `src/lib/llm/batch.ts` | yt-dual-subs（background.js retry/timeout） | MIT | OK |
| 8 | `src/features/overlay/Overlay.tsx` | yt-dual-subs（content.js overlay lifecycle） | MIT | OK |
| 9 | `src/features/overlay/OverlayView.tsx` | yt-dual-subs（content.js overlay DOM） | MIT | OK |
| 10 | `src/features/overlay/position.ts` | yt-dual-subs（overlay geometry） | MIT | OK |
| 11 | `src/features/overlay/use-player-snapshot.ts` | yt-dual-subs（player snapshot） | MIT | OK |
| 12 | `src/lib/ui/page-style.ts` | yt-dual-subs（content.css caption suppression） | MIT | OK |
| 13 | `src/features/playback/attach.ts` | Nitrino/easysubs 3.1.3（YouTube adapter） | MIT | OK |
| 14 | `src/features/playback/controller.ts` | easysubs（sentence seek）+ SceneLingo（rAF/latch） | MIT | OK |
| 15 | `src/features/playback/keyboard.ts` | easysubs（typing guard）+ SceneLingo（key guards） | MIT | OK |
| 16 | `src/features/sidebar/Sidebar.tsx` | easysubs（transcript panel） | MIT | OK |
| 17 | `src/features/sidebar/SentenceRow.tsx` | easysubs（transcript row） | MIT | OK |
| 18 | `src/features/sidebar/useAutoScroll.ts` | easysubs（auto-scroll） | MIT | OK |

标准头格式（每文件顶部）：

```text
Adapted for Earworm (MIT) from <repo> (<license>) — Copyright (c) <year> <author>
Upstream: <url> (<file/function scope>)
Full upstream MIT permission text: see NOTICE.
```

### 审计结论与判断

- **yt-dual-subs**：MIT，Copyright (c) 2026 Gythiro。inject/transcript/overlay/
  page-style/LLM channel 均据其源码改写；翻译 prompt 文本为 Earworm 自写，
  只保留通道形状与重试策略的归属。
- **easysubs**：MIT，Copyright (c) 2022 Seo Jong Hak。playback 的句级
  previous/repeat/next 语义、YouTube adapter、键盘 typing guard，以及 sidebar
  的行/面板/自动滚动行为被改编；快捷键映射（`a`/`s`/`d`）与成句模型是
  Earworm 自研。
- **SceneLingo**：MIT，Copyright (c) 2026 Umut。仅借鉴 playback 的
  requestAnimationFrame + per-range latch 自动暂停模式与键盘注册 guard；
  没有 vendored 文件，也没有复制其 word/phrase prompt 文本。因其源码被阅读并
  影响了实现，`controller.ts` / `keyboard.ts` 保守地继续保留 SceneLingo 版权头。
- **dictionary / prompt**：`src/features/dictionary/*`、`src/lib/llm/prompt.ts`
  为原创（T12/T4），未复制 SceneLingo prompt 或词典 UI 代码；ECDICT 的数据
  归属由 `NOTICE` 覆盖。
- 所有被改编文件的原有版权行均保留在文件头，完整 MIT 许可文本集中在
  `NOTICE`。

## 审查后确认无需第三方头的文件

| 文件 | 原因 |
|---|---|
| `src/features/overlay/index.ts` | 纯 re-export |
| `src/features/playback/index.ts` | 纯 re-export |
| `src/features/playback/PlaybackShortcuts.tsx` | 原创 React 组合层；改编逻辑在 `keyboard.ts` / `controller.ts` |
| `src/lib/llm/cache.ts` | 原创 IndexedDB 缓存 |
| `src/lib/llm/parse.ts` | 原创防御性解析 / span 对齐 |
| `src/lib/llm/prompt.ts` | 原创 prompt；未复制 SceneLingo 文本 |
| `src/lib/llm/translate-handler.ts` | 原创 background handler |
| `src/lib/transcript/index.ts` | 纯 re-export |
| `src/lib/transcript/__fixtures__/json3.ts` | Earworm 自造测试 fixture |
| `src/features/dictionary/*` | 原创点词弹窗（T12）；只读取 ECDICT 数据 |
| `src/components/ui/*` | shadcn/ui 生成并本地定制的组件；其 MIT 归属在 `NOTICE` 的依赖与许可段落统一说明，未逐个加头 |

## 数据审计

| 生成物 | 来源 | 许可 / 署名 | 重建 | 运行时元数据 |
|---|---|---|---|---|
| `public/data/ecdict.json`（50,961 条） | skywind3000/ECDICT（MIT，Copyright (c) 2025 Linwei） | MIT；上游逐条数据出处有第三方署名歧义，见 `NOTICE` | `pnpm build:ecdict` | `meta.version` / count；无 license 字段，归属见 `NOTICE` |
| `public/data/lemmas.json`（46,287 映射） | ECDICT `lemma.en.txt` | MIT | `pnpm build:ecdict` | 同上 |
| `public/data/collocations.json`（9,289 条） | vladvlasov256/opensubs-collocations | CC-BY 4.0；OpenSubtitles, Lison & Tiedemann 2016 | `pnpm build:collocations` | `meta.license = CC-BY-4.0`、`meta.attribution`、`meta.sourceUrl` |

OpenSubtitles 引用（同时写入 `NOTICE` 与 README）：

> Pierre Lison and Jörg Tiedemann. 2016. *OpenSubtitles2016: Extracting Large
> Parallel Corpora from Movie and TV Subtitles.* LREC 2016.

原始输入（`data/ecdict.csv`、`data/lemma.en.txt`、`data/en.jsonl`）不入库；
只提交确定性生成物。`public/data/README.md` 记录了每个文件的生成脚本与许可。

## GPL / AGPL 检查

- 源码与 docs 中没有 GPL/AGPL 许可全文，也没有 GPL/AGPL 的 SPDX 声明。
- 仅有说明性文字：`docs/adr/0001`、`0003`、`0004` 提到 asbplayer（AGPL）与
  kiss-translator/yomitan/10ten/DualSub（GPL）只作调研；`src/entrypoints/inject.ts`
  第 254 行注释说明 asbplayer 的 innertube 降级「只有思路、没有 copy 代码」。
- 未发现 GPL/AGPL 源文件被 vendored 的迹象；审计脚本把这些全文/SPDX 模式
  作为失败条件。

## 验证

在合并 T13 之前、基于 `6acfab6`：

```text
pnpm typecheck  PASS
pnpm test       PASS — 49 files / 429 tests
pnpm build      PASS — .output/chrome-mv3（6.84 MB，manifest verify OK）
node scripts/audit-attribution.mjs  PASS — 66/66 checks
```

合并最新 `integration/earworm-v1` tip 后需重跑上述四项；issue #16 评论记录
合并后的提交 SHA。

## 残余风险 / 后续注意

1. **ECDICT 逐条出处**：仓库 LICENSE 是 MIT，但 ECDICT 数据由多个上游词典与
   词表汇编，个别条目可能带 CC-BY 类署名义务。当前无法在不重做数据溯源的情况下
   逐条核实；`NOTICE` 已明确披露该歧义，Earworm 只分发裁剪后的派生词表。
   若未来更换数据源或上游补充逐条许可，应同步更新 `NOTICE` 与
   `public/data/README.md`。
2. **SceneLingo 的归属粒度**：当前是把「模式级改编」登记为 adapted（保守做法）。
   若未来复制其 prompt 文本或函数级代码，必须把 SceneLingo 头加到相应文件
   （尤其 `src/lib/llm/prompt.ts`）并更新 `NOTICE`；反之，若确认完全独立实现，
   可以降级为「inspiration only」，但不能在未核实前删掉现有版权行。
3. **shadcn/ui 组件**：`src/components/ui/*` 是按 shadcn CLI 生成后定制的文件，
   本 ticket 不为它们逐文件加头；MIT 归属与许可全文在 `NOTICE` 的依赖段落。
   若未来手工复制 shadcn 上游源码而非生成，应重新评估逐文件头。
4. **新增上游代码**：任何新 copy/adapt 必须先过 ADR-0004，并在文件头加同一格式
   的 `Adapted for Earworm` 注释；`scripts/audit-attribution.mjs` 会把
   「提到上游但没有头」视为失败。
5. **数据再生成**：`pnpm build:ecdict` / `pnpm build:collocations` 依赖本地
   gitignored 输入；CI 若没有输入文件，应跳过数据重建并校验已提交生成物，
   而不是静默生成空表。
6. **发布包未包含 NOTICE/LICENSE**：WXT 构建产物 `.output/chrome-mv3` 目前
   只复制 `public/` 与入口产物，根目录的 `NOTICE` / `LICENSE` 不在包内。
   源码仓库分发的归属是完整的；但若把商店安装包视为独立副本，MIT/CC-BY
   要求随包附上声明。本 ticket 不改 `wxt.config.ts` / `package.json`，建议
   T16 在构建配置中把这两个文件复制进产物，或在发布说明中附上仓库链接。
7. **范围偏差（已记录）**：`src/lib/ui/page-style.ts` 与
   `src/features/sidebar/*` 不在本 ticket 最初列出的目录清单中，但它们是实际
   adapted 文件；本次只补/规范了顶部版权注释，没有改逻辑。新增
   `scripts/audit-attribution.mjs` 作为可复现审计工具，未改 `package.json`。

## 相关文件

- [`LICENSE`](../LICENSE) — 项目 MIT
- [`NOTICE`](../NOTICE) — 第三方代码、数据、依赖与 MIT 全文
- [`README.md`](../README.md) — 数据来源与重建命令
- [`public/data/README.md`](../public/data/README.md) — 生成物与输入说明
- [`docs/adr/0004-reuse-mit-only.md`](./adr/0004-reuse-mit-only.md) — 复用策略
- [`scripts/audit-attribution.mjs`](../scripts/audit-attribution.mjs) — 本次审计脚本
