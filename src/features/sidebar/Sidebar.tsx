/**
 * In-page bilingual sentence sidebar (F2).
 *
 * Rendered inside T1's body-level shadow root as a fixed panel, never inside
 * `#secondary-inner` (React would escape the shadow root). On a wide watch
 * page it occupies the recommended-videos column; elsewhere it becomes a
 * closable right drawer.
 *
 * Panel event isolation (stop player click/wheel/key bubbling) follows the
 * easysubs transcript panel. Adapted from easysubs
 * (https://github.com/Nitrino/easysubs), Copyright (c) 2022 Seo Jong Hak,
 * MIT License — see NOTICE.
 */
import { useCallback, useRef, type CSSProperties, type SyntheticEvent } from 'react';
import { PanelRightClose, XIcon } from 'lucide-react';
import { useSession, type TranslationProgress } from '@/features/session';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { SentenceRow } from './SentenceRow';
import { computeSidebarLayout } from './selectors';
import { useSidebarEnvironment } from './useSidebarEnvironment';
import { useAutoScroll } from './useAutoScroll';

/** Same wording as the status pill / overlay states in ContentApp. */
const ACQUIRING_TEXT = '字幕载入中…';
const NO_CAPTIONS_TEXT = '无字幕';
const ERROR_TEXT = '字幕获取失败';
const EMPTY_TEXT = '暂无字幕';

function stopPlayerEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

function TranslationStatus({ progress }: { progress: TranslationProgress }) {
  const label =
    progress.state === 'running'
      ? `翻译中 ${progress.done}/${progress.total}`
      : `翻译 ${progress.done}/${progress.total}`;

  return (
    <span
      data-translation-progress
      role="status"
      aria-live="polite"
      className="truncate text-xs text-muted-foreground"
    >
      {label}
      {progress.failed > 0 ? (
        <span data-translation-failed className="ml-1 text-red-600">
          失败 {progress.failed}
        </span>
      ) : null}
    </span>
  );
}

function StateNotice({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const HEADER_ICON_BUTTON =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50';

export function Sidebar() {
  const { state, seekToSentence, retrySentence, retryAll } = useSession();
  const { settings, set } = useSettings();
  const environment = useSidebarEnvironment();
  const layout = computeSidebarLayout(environment);
  const listRef = useRef<HTMLDivElement | null>(null);

  const visible = settings.ui.sidebar;
  const hasSentences = state.status === 'ready' && state.sentences.length > 0;

  const toggleSidebar = useCallback((): void => {
    set({ ui: { sidebar: !settings.ui.sidebar } });
  }, [set, settings.ui.sidebar]);

  const handleSeek = useCallback(
    (id: number): void => {
      seekToSentence(id);
    },
    [seekToSentence],
  );

  const handleRetry = useCallback(
    (id: number): void => {
      retrySentence(id);
    },
    [retrySentence],
  );

  const handleRetryAll = useCallback((): void => {
    retryAll();
  }, [retryAll]);

  const { onScroll } = useAutoScroll({
    listRef,
    currentId: hasSentences ? state.currentIndex : null,
    active: visible && hasSentences,
  });

  // Nothing to show until a video session exists; a hidden sidebar renders
  // nothing at all (the future keyboard toggle / options re-open it).
  if (!visible || state.status === 'idle') return null;

  const panelClassName = cn(
    'pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-border',
    'bg-background/95 text-foreground shadow-xl backdrop-blur-sm',
    layout.mode === 'drawer' && 'shadow-2xl',
  );

  return (
    <aside
      data-earworm-sidebar
      data-mode={layout.mode}
      aria-label="字幕侧栏"
      style={layout.style as CSSProperties}
      className={panelClassName}
      onClick={stopPlayerEvent}
      onDoubleClick={stopPlayerEvent}
      onMouseDown={stopPlayerEvent}
      onMouseUp={stopPlayerEvent}
      onPointerDown={stopPlayerEvent}
      onPointerUp={stopPlayerEvent}
      onWheel={stopPlayerEvent}
      onKeyDown={stopPlayerEvent}
      onKeyUp={stopPlayerEvent}
      onKeyPress={stopPlayerEvent}
    >
      <header
        data-sidebar-header
        className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2"
      >
        <h2 className="shrink-0 text-sm font-semibold">字幕</h2>
        <TranslationStatus progress={state.translation} />
        <div className="ml-auto flex items-center gap-1">
          {state.translation.failed > 0 ? (
            <button
              type="button"
              onClick={handleRetryAll}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-600 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              全部重试
            </button>
          ) : null}
          {layout.mode === 'drawer' ? (
            <button
              type="button"
              aria-label="关闭字幕侧栏"
              title="关闭字幕侧栏"
              onClick={toggleSidebar}
              className={HEADER_ICON_BUTTON}
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="收起字幕侧栏"
            title="收起字幕侧栏"
            onClick={toggleSidebar}
            className={HEADER_ICON_BUTTON}
          >
            <PanelRightClose className="size-4" />
          </button>
        </div>
      </header>

      {state.status === 'acquiring' ? (
        <StateNotice title={ACQUIRING_TEXT} hint="正在获取视频字幕" />
      ) : null}

      {state.status === 'no-captions' ? (
        <StateNotice title={NO_CAPTIONS_TEXT} hint="该视频没有可用字幕" />
      ) : null}

      {state.status === 'error' ? (
        <StateNotice title={ERROR_TEXT} hint={state.error ?? '请稍后重试'} />
      ) : null}

      {state.status === 'ready' && state.sentences.length === 0 ? (
        <StateNotice title={EMPTY_TEXT} />
      ) : null}

      {hasSentences ? (
        <div
          ref={listRef}
          data-sentence-list
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"
          onScroll={onScroll}
        >
          {state.sentences.map((sentence, index) => (
            <SentenceRow
              key={sentence.id}
              sentence={sentence}
              isCurrent={index === state.currentIndex}
              onSeek={handleSeek}
              onRetry={handleRetry}
            />
          ))}
        </div>
      ) : null}
    </aside>
  );
}
