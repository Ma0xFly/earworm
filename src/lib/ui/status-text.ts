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
