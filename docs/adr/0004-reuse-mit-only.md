# 复用策略：只 copy MIT 源，其余只借鉴思路

2026-11-24 调研覆盖 asbplayer、immersive-translate、nextai-translator、yomitan、10ten、kiss-translator、DualSub、captionary、easysubs、yt-dual-subs、SceneLingo、SLL。决定：earworm 以 MIT 发布；代码只从 MIT 源 copy——yt-dual-subs（字幕获取 inject.js、双语渲染、BYOK 翻译通道）与 easysubs（句级导航、YouTube 适配器），保留原版权声明；SceneLingo 的短语命中 prompt 审读后候选。asbplayer/nextai-translator（AGPL）、kiss-translator/yomitan/10ten/DualSub（GPL）只借鉴思路不碰代码；captionary 无 license（默认版权保留）禁 copy，仅作交互规格参考，不联系作者。

## Consequences

搭配高亮在全部调研项目中无现成实现，是 earworm 的自研差异化点；copy 处必须保留 MIT 版权声明，未来引入 GPL/AGPL 代码会改变整个项目的分发义务。