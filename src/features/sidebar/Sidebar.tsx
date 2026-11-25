/**
 * In-page bilingual sentence sidebar (F2).
 *
 * The docked panel is inserted into YouTube's recommended-videos column as a
 * document-flow block: `<earworm-sidebar-host>` is prepended to
 * `#secondary-inner` (or `#secondary` when the inner column is absent), owns a
 * nested open shadow root, and the panel is rendered into it through a React
 * portal. The host is created by `./host` and kept in the current column by
 * `./useSidebarHost` across SPA navigation. Recommended videos are pushed
 * below the panel; the panel has a fixed height with its own scrolling list,
 * so it never covers the page and scrolls away with it.
 *
 * When `#secondary` is unusable (narrow layout, hidden by YouTube) or the page
 * is fullscreen, the sidebar falls back to the fixed right drawer rendered in
 * the body-level shadow root. `settings.ui.sidebar=false` removes the host so
 * the recommended videos move back up; a small persistent reopen control stays.
 *
 * Panel event isolation (stop player click/wheel/key bubbling) follows the
 * easysubs transcript panel.
 *
 * Adapted for Earworm (MIT) from Nitrino/easysubs (MIT) — Copyright (c) 2022 Seo Jong Hak.
 * Upstream: https://github.com/Nitrino/easysubs (transcript panel event isolation).
 * Full upstream MIT permission text: see NOTICE.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { PanelRightClose, XIcon } from 'lucide-react';
import { useSession, type TranslationProgress } from '@/features/session';
import { useSettings } from '@/lib/settings';
import { useShadowCss } from '@/lib/ui/shadow-css';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { SESSION_STATUS_TEXT } from '@/lib/ui/status-text';
import { SentenceRow } from './SentenceRow';
import { computeSidebarLayout } from './selectors';
import { useSidebarEnvironment } from './useSidebarEnvironment';
import { useSidebarHost } from './useSidebarHost';
import { useAutoScroll } from './useAutoScroll';

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
      className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
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

function StateNotice({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}

const HEADER_ICON_BUTTON =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50';

export function Sidebar() {
  const { state, seekToSentence, retrySentence, retryAll, setContinuous } =
    useSession();
  const { settings, set } = useSettings();
  const environment = useSidebarEnvironment();
  const layout = computeSidebarLayout(environment);
  const css = useShadowCss();
  const listRef = useRef<HTMLDivElement | null>(null);

  const visible = settings.ui.sidebar;
  const hasSentences = state.status === 'ready' && state.sentences.length > 0;
  const docked = layout.mode === 'docked';
  const host = useSidebarHost({
    css,
    enabled: docked && visible && state.status !== 'idle',
  });

  // The nested shadow root cannot see the app root's `data-blur-*` attributes,
  // so mirror the current blur state onto the host element (NESTED_BLUR_CSS
  // matches it with `:host([data-blur-en="1"])`).
  useEffect(() => {
    const node = host?.host;
    if (!node) return;
    node.setAttribute('data-blur-en', settings.blur.en ? '1' : '0');
    node.setAttribute('data-blur-zh', settings.blur.zh ? '1' : '0');
  }, [host, settings.blur.en, settings.blur.zh]);

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

  // Nothing to show before a session exists. When the panel is hidden but a
  // session does exist, keep a small persistent reopen control: both close
  // affordances live inside the panel, so without it a closed sidebar could
  // never be reopened from the page.
  if (state.status === 'idle') return null;

  if (!visible) {
    return (
      <button
        type="button"
        data-earworm-sidebar-reopen
        aria-label="显示字幕侧栏"
        title="显示字幕侧栏"
        onClick={() => set({ ui: { sidebar: true } })}
        onPointerDown={stopPlayerEvent}
        className="pointer-events-auto fixed right-3 top-3 z-50 inline-flex items-center rounded-full border border-border bg-background/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-lg outline-none backdrop-blur-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        字幕
      </button>
    );
  }

  const panelClassName = cn(
    'pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-border',
    'bg-background/95 text-foreground shadow-xl backdrop-blur-sm',
    layout.mode === 'drawer' && 'shadow-2xl',
  );

  const panel = (
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
          {/* Spec F3: continuous playback must be reachable from the sidebar. */}
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline"
            >
              连续
            </span>
            <Switch
              size="sm"
              aria-label="连续播放"
              title="连续播放：开启后当前句播完自动进入下一句"
              checked={settings.playback.continuous}
              onCheckedChange={setContinuous}
            />
          </span>
          {state.translation.failed > 0 ? (
            <button
              type="button"
              onClick={handleRetryAll}
              className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-red-600 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-ring/50"
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
        <StateNotice title={SESSION_STATUS_TEXT.acquiring} hint="正在获取视频字幕" />
      ) : null}

      {state.status === 'no-captions' ? (
        <StateNotice title={SESSION_STATUS_TEXT.noCaptions} hint="该视频没有可用字幕" />
      ) : null}

      {state.status === 'error' ? (
        <StateNotice
          title={SESSION_STATUS_TEXT.error}
          hint={state.error ?? '请稍后重试'}
          action={
            <button
              type="button"
              data-acquisition-retry
              className="mt-2 inline-flex items-center rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={handleRetryAll}
            >
              重试
            </button>
          }
        />
      ) : null}

      {state.status === 'ready' && state.sentences.length === 0 ? (
        <StateNotice title={SESSION_STATUS_TEXT.empty} />
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

  // Docked: portal into the nested shadow root in `#secondary-inner`. Drawer:
  // render in the body-level shadow root (the caller's React tree).
  if (docked) {
    return host ? createPortal(panel, host.container) : null;
  }
  return panel;
}
