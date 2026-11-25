/**
 * Subtitle export (F7 / ticket #35).
 *
 * The data source is deliberately `useSession().state.sentences`: those
 * sentences are already populated from the 翻译缓存 when a video is re-opened,
 * so exporting issues ZERO new LLM requests. Reading the cache again from a
 * click handler would need `cuesHash` (private to `useSessionEngine`) and would
 * bump the cache entry's LRU timestamp. Partial translations have no cache row
 * and exist only in this in-memory state, which is why export uses it.
 */
import { useCallback, useState } from 'react';
import { useSession } from '@/features/session';
import { readVideoMeta } from '@/features/session/meta';
import {
  formatSrt,
  formatTxt,
  sanitizeFileName,
} from '@/lib/export/subtitles';

export type SubtitleExportFormat = 'srt' | 'txt';

function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next task so the browser has consumed the blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useSubtitleExport() {
  const { state } = useSession();
  const { sentences, meta, videoId } = state;
  const [formatOpen, setFormatOpen] = useState(false);

  const exportSubtitles = useCallback(
    (format: SubtitleExportFormat) => {
      // `meta` is captured when the track arrives; right after an SPA
      // navigation it may still describe the previous video.
      const title = meta?.title?.trim() || readVideoMeta(videoId ?? '').title;
      const basename = sanitizeFileName(title, videoId ?? '');
      const content = format === 'srt' ? formatSrt(sentences) : formatTxt(sentences);
      downloadText(
        `${basename}.${format}`,
        content,
        format === 'srt' ? 'application/x-subrip' : 'text/plain',
      );
      setFormatOpen(false);
    },
    [sentences, meta, videoId],
  );

  const exportSrt = useCallback(() => exportSubtitles('srt'), [exportSubtitles]);
  const exportTxt = useCallback(() => exportSubtitles('txt'), [exportSubtitles]);

  return { exportSubtitles, exportSrt, exportTxt, formatOpen, setFormatOpen };
}
