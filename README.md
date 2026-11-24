# Earworm

英语听力学习浏览器扩展（Chrome / Edge，Manifest V3）：在 YouTube 上提供双语字幕、
逐句复听与点词查词。

> 项目术语见 [`GLOSSARY.md`](./GLOSSARY.md)，架构决策见 [`docs/adr/`](./docs/adr/)。

## 功能（v1）

- **双语字幕**：英文原文 + 自有 LLM 中文翻译，叠加在播放器上；原生字幕层被视觉抑制。
- **模糊**：英 / 中字幕可独立模糊，悬停临时看清。
- **逐句列表**：页面右侧显示逐句双语列表，当前句高亮并自动滚动，点击跳转。
- **逐句播放**：`a` / `s` / `d` = 上一句 / 重复当前句 / 下一句；默认句尾暂停，可切换连续播放。
- **点词词典**：点击字幕单词弹出音标、中文释义、词性与考试标签；命中搭配时显示搭配条目。
- **搭配高亮**：离线 OpenSubtitles 二元表立即高亮，LLM 标注的搭配随后叠加。

## 技术栈

WXT 0.21（MV3）+ React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui（Radix）。
测试使用 Vitest + happy-dom + Testing Library。

## 开发

要求 Node.js ≥ 22、pnpm 11。

```bash
pnpm install
pnpm dev          # WXT 开发模式（自动打开浏览器并加载扩展）
pnpm typecheck    # wxt prepare + tsc --noEmit
pnpm test         # Vitest 单元测试（不联网）
pnpm build        # 生产构建，产物在 .output/chrome-mv3
```

开发时 UI 全部渲染在一个 body 级 shadow root 中，与 YouTube 页面样式互相隔离；
Tailwind 的 preflight 被刻意关闭（只引入 theme + utilities），避免重置宿主页面。

### 加载未打包扩展

1. `pnpm build`（或保持 `pnpm dev` 运行）。
2. Chrome / Edge 打开 `chrome://extensions`。
3. 打开右上角「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择 `.output/chrome-mv3`。
5. 打开任意有**人工英文字幕**的 YouTube 视频，扩展会挂载字幕 overlay 和右侧列表。

### 设置

扩展设置页（`chrome://extensions` → Earworm → 扩展选项）可配置：

- LLM 端点三件套：`baseUrl`、`apiKey`、`model`。
  默认 `http://127.0.0.1:3425/v1` + `group/free-ds`（本机 magpie 网关）。
- 英文 / 中文模糊默认态。
- 连续播放默认态。

API key 只保存在 `chrome.storage.local`，不会写入 `storage.sync`、日志或 URL。
非 localhost 的自定义端点会在保存时按需申请 host 权限。

## 数据来源与重建

离线数据生成物提交在 `public/data/`，扩展运行时通过
`chrome.runtime.getURL('data/<file>')` 读取，并注册为 `web_accessible_resources`。
原始输入文件位于 gitignored 的 `data/`，不入库；下表给出每个生成物的来源、许可与
重建命令。完整归属与许可见 [`NOTICE`](./NOTICE)，逐文件审计记录见
[`docs/compliance.md`](./docs/compliance.md)。

| 生成物 | 来源 | 许可 / 署名 | 重建 |
| --- | --- | --- | --- |
| `public/data/ecdict.json`、`public/data/lemmas.json` | [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) | MIT（Copyright (c) 2025 Linwei；上游数据逐条出处存在第三方署名歧义，见 NOTICE） | `pnpm build:ecdict` |
| `public/data/collocations.json` | [vladvlasov256/opensubs-collocations](https://huggingface.co/datasets/vladvlasov256/opensubs-collocations) | CC-BY 4.0；OpenSubtitles, Lison & Tiedemann 2016 | `pnpm build:collocations` |

### ECDICT 词典（T5）

输入：`data/ecdict.csv`（63MB）与 `data/lemma.en.txt`，来自
[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)（MIT，
Copyright (c) 2025 Linwei）。输入文件不入库。

```bash
pnpm build:ecdict
```

环境变量 `ECDICT_CSV` / `LEMMA_TXT` 可覆盖默认路径。生成
`public/data/ecdict.json` 与 `public/data/lemmas.json`。ECDICT 数据由多个上游
词典与词表汇编而成，仓库 LICENSE 为 MIT，但个别上游内容的署名条款未逐条列明；
本仓库按 MIT 分发裁剪后的生成物，并在 `NOTICE` 中保留该出处歧义说明。

### OpenSubtitles 搭配表（T6）

输入：`data/en.jsonl`，来自
[vladvlasov256/opensubs-collocations](https://huggingface.co/datasets/vladvlasov256/opensubs-collocations)
（CC-BY 4.0）。输入文件不入库。

```bash
pnpm build:collocations
```

环境变量 `OPENSUBS_JSONL` 可覆盖默认路径。生成 `public/data/collocations.json`，
其 `meta` 字段记录来源 URL、许可与署名。使用该数据时请保留以下署名：

> OpenSubtitles；Pierre Lison and Jörg Tiedemann. 2016. *OpenSubtitles2016:
> Extracting Large Parallel Corpora from Movie and TV Subtitles.* LREC 2016.

### Playground（T14）

`pnpm playground` 预留为离线 playground 的启动脚本；对应目录由 T14 提供。

## 目录结构

```
src/
  entrypoints/        WXT 入口：content、inject（MAIN world）、background、options
  lib/                共享契约、消息、设置、shadow DOM 壳、数据访问 stub
  components/ui/      vendored shadcn/ui 组件
  features/           功能模块（overlay / sidebar / playback / blur / dictionary /
                      reading / session / options）
public/data/          离线数据生成物
scripts/              数据构建脚本
tests/                Vitest 测试
playground/           离线调试环境（T14 实现）
```

## 许可

Earworm 以 MIT 发布，见 [`LICENSE`](./LICENSE)。被 copy/adapt 的第三方 MIT
代码在文件头保留版权与来源，完整许可文本、数据署名与依赖说明见
[`NOTICE`](./NOTICE)；逐文件审计与残余风险见
[`docs/compliance.md`](./docs/compliance.md)。
