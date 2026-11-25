# 字幕来自播放器运行时轨道，而非官方 API

YouTube Data API v3 的 captions.download 仅对视频所有者开放，不存在面向任意视频的官方字幕 API；2025 年起部分视频的 timedtext 强制 PO token，带登录 cookie 的同源 fetch 也返回空 body。决定：注入页面上下文（MAIN world），首选嗅探播放器自身发出的 timedtext 请求、复用带 pot 的 URL 以 json3 重取（copy 自 MIT 的 yt-dual-subs）；asbplayer（PR#978，AGPL 只借鉴思路）的运行时对象读取与 innertube player 作降级。英文字幕轨人工优先、自动兜底：无人工轨时接受 YouTube 官方自动生成的英文字幕（kind=asr，与 Language Reactor 同源）；ASR 成句走标点（若有）+ 停顿 ≥0.8s + 20 词上限。无英文字幕的视频显示「无字幕」提示。（2026-11-25 修订：原 manual-only 范围与用户实际片库冲突——技术区 YouTube 多为 ASR-only，实测 Dave2D ZedAs9P7yE8 仅 1 条 asr 轨；用户所称「官方字幕」即该轨，不存在第二官方来源。）

## Considered Options

- 官方 Data API v3：所有者限制，无法用于任意视频，弃。
- 第三方字幕站：覆盖与质量不稳，引入额外依赖，弃。
- youtube-transcript-api 式服务端路线：库本身不生成 PO token，云 IP 普遍被封，不适合浏览器扩展，弃。

## Consequences

获取层与 YouTube 风控处于军备竞赛，接口/选择器随时可能失效，必须维持多级降级。这是「与播放器同源」路线的固有代价。