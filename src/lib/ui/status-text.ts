/**
 * User-facing acquisition status wording shared by the overlay and sidebar.
 * Keeping one map avoids three slightly different Chinese labels drifting.
 */
export const SESSION_STATUS_TEXT = {
  acquiring: '字幕载入中…',
  noCaptions: '无字幕',
  error: '字幕获取失败',
  empty: '暂无字幕',
} as const;

/** Shown whenever a failure reason has no specific user-facing hint. */
const GENERIC_FAILURE_HINT = '请稍后重试';

/**
 * Acquisition failure reason → Chinese hint. The reasons are the internal
 * `TranscriptFailureReason` codes, which are diagnostics only: they must never
 * be shown to the user verbatim.
 */
const FAILURE_HINT_TEXT: Record<string, string> = {
  'nudge-failed': '播放器未能加载所选字幕轨，请重试',
  timeout: '字幕获取超时，请重试',
  http: '字幕接口请求失败，请稍后重试',
  'no-captions': '该视频没有可用的英文字幕',
};

/** Map an acquisition failure reason to a user-facing Chinese hint. */
export function failureHint(reason?: string): string {
  if (!reason) return GENERIC_FAILURE_HINT;
  return FAILURE_HINT_TEXT[reason] ?? GENERIC_FAILURE_HINT;
}
