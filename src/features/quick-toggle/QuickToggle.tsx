/**
 * Quick toggle (F2): logo button + quick menu in YouTube's control bar.
 *
 * The button cluster is React-portaled into `<earworm-quick-toggle-host>`'s
 * nested shadow root so it sits immediately left of the CC button. The Radix
 * menu itself portals into the body-level shadow root (via the canonical
 * `PopoverContent`), which keeps the dark surface isolated and unclipped by
 * the player. Both roots receive the same compiled stylesheet.
 */
import { useEffect, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { BlurSwitches } from '@/features/blur';
import { useSubtitleExport } from '@/features/export';
import { useSession } from '@/features/session';
import { useSettings } from '@/lib/settings';
import { useShadowCss } from '@/lib/ui/shadow-css';
import {
  createQuickToggleHost,
  startQuickToggleHostLifecycle,
  type QuickToggleHost,
} from './host';

const BUTTON_CLASS =
  'inline-flex size-8 items-center justify-center rounded-[8px] text-white/90 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60';

function stopPlayerEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

export function QuickToggle() {
  const { settings, set } = useSettings();
  const { state, retryAll } = useSession();
  const { exportSrt, exportTxt, formatOpen, setFormatOpen } = useSubtitleExport();
  const css = useShadowCss();
  const [host, setHost] = useState<QuickToggleHost | null>(null);
  const enabled = settings.ui.enabled;

  useEffect(() => {
    const instance = createQuickToggleHost({ css });
    setHost(instance);
    const stop = startQuickToggleHostLifecycle(instance);
    return () => {
      stop();
      instance.destroy();
      setHost(null);
    };
  }, [css]);

  const toggle = (): void => {
    set({ ui: { enabled: !enabled } });
  };

  const openOptions = (): void => {
    void chrome.runtime.openOptionsPage?.();
  };

  const progress = state.translation;
  const progressLabel =
    progress.state === 'running'
      ? `翻译中 ${progress.done}/${progress.total}`
      : `翻译 ${progress.done}/${progress.total}`;

  const cluster = host ? (
    createPortal(
      <div
        data-earworm-quick-toggle-cluster
        className="inline-flex items-center gap-0.5"
        onClick={stopPlayerEvent}
        onPointerDown={stopPlayerEvent}
      >
        <button
          type="button"
          data-earworm-quick-toggle
          aria-label={enabled ? '关闭 earworm' : '开启 earworm'}
          aria-pressed={enabled}
          title={enabled ? '关闭 earworm 字幕' : '开启 earworm 字幕'}
          className={BUTTON_CLASS}
          onClick={toggle}
        >
          <img
            src={chrome.runtime.getURL('brand/earworm-icon-32.png')}
            alt=""
            width={20}
            height={20}
          />
        </button>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-earworm-quick-menu-trigger
            aria-label="快捷菜单"
            title="快捷菜单"
            className={BUTTON_CLASS}
          >
            <ChevronDown className="size-3" aria-hidden />
          </button>
        </PopoverTrigger>
      </div>,
      host.container,
    )
  ) : null;

  return (
    <Popover onOpenChange={(open) => { if (!open) setFormatOpen(false); }}>
      {cluster}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-64 rounded-lg border border-violet-6 bg-popover p-3 text-popover-foreground shadow-xl"
      >
        <div
          data-earworm-quick-menu
          className="dark flex flex-col gap-2 text-xs"
        >
          <p data-earworm-quick-menu-title className="text-sm font-semibold">
            earworm 快捷菜单
          </p>
          <Separator className="bg-violet-6" />

          <BlurSwitches className="flex items-center gap-1.5" />

          <span
            data-translation-progress
            role="status"
            aria-live="polite"
            className="text-popover-foreground/80"
          >
            {progressLabel}
            {progress.failed > 0 ? (
              <span data-translation-failed className="ml-1 text-red-400">
                失败 {progress.failed}
              </span>
            ) : null}
          </span>

          {progress.failed > 0 ? (
            <button
              type="button"
              onClick={retryAll}
              className="rounded-[8px] border border-violet-6 px-2 py-1 font-medium text-popover-foreground hover:bg-secondary"
            >
              全部重试
            </button>
          ) : null}

          <Separator className="bg-violet-6" />

          <button
            type="button"
            data-earworm-menu-settings
            onClick={openOptions}
            className="rounded-[8px] px-2 py-1 text-left hover:bg-secondary"
          >
            设置
          </button>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              data-earworm-export
              aria-expanded={formatOpen}
              title="导出双语字幕"
              onClick={() => setFormatOpen((open) => !open)}
              className="rounded-[8px] px-2 py-1 text-left hover:bg-secondary"
            >
              字幕导出
            </button>
            {formatOpen ? (
              <div data-earworm-export-formats className="flex gap-2 pl-2">
                <button
                  type="button"
                  data-earworm-export-srt
                  onClick={exportSrt}
                  className="rounded-[8px] border border-violet-6 px-2 py-1 font-medium text-popover-foreground hover:bg-secondary"
                >
                  SRT
                </button>
                <button
                  type="button"
                  data-earworm-export-txt
                  onClick={exportTxt}
                  className="rounded-[8px] border border-violet-6 px-2 py-1 font-medium text-popover-foreground hover:bg-secondary"
                >
                  TXT
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
