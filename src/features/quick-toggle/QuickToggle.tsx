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
import { useSession } from '@/features/session';
import { useSettings } from '@/lib/settings';
import { useShadowCss } from '@/lib/ui/shadow-css';
import {
  createQuickToggleHost,
  startQuickToggleHostLifecycle,
  type QuickToggleHost,
} from './host';

const BUTTON_CLASS =
  'inline-flex size-8 items-center justify-center rounded-md text-white/90 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60';

function stopPlayerEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

export function QuickToggle() {
  const { settings, set } = useSettings();
  const { state, retryAll } = useSession();
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
    <Popover>
      {cluster}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-64 border border-[#473876] bg-[#1B1525] p-3 text-[#E2DDFE] shadow-xl"
      >
        <div
          data-earworm-quick-menu
          className="dark flex flex-col gap-2 text-xs"
        >
          <p data-earworm-quick-menu-title className="text-sm font-semibold">
            earworm 快捷菜单
          </p>
          <Separator className="bg-[#473876]" />

          <BlurSwitches className="flex items-center gap-1.5" />

          <span
            data-translation-progress
            role="status"
            aria-live="polite"
            className="text-[#BAA7FF]"
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
              className="rounded-md border border-[#473876] px-2 py-1 font-medium text-[#E2DDFE] hover:bg-[#33255B]"
            >
              全部重试
            </button>
          ) : null}

          <Separator className="bg-[#473876]" />

          <button
            type="button"
            data-earworm-menu-settings
            onClick={openOptions}
            className="rounded-md px-2 py-1 text-left hover:bg-[#33255B]"
          >
            设置
          </button>
          <button
            type="button"
            data-earworm-export
            disabled
            title="字幕导出（即将推出）"
            className="rounded-md px-2 py-1 text-left text-[#BAA7FF] disabled:opacity-60"
          >
            字幕导出（即将推出）
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
