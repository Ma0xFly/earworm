import { useSettings } from '@/lib/settings';
import { useSession } from '@/features/session';
import { Overlay } from '@/features/overlay';
import { Sidebar } from '@/features/sidebar';
import { BlurControls } from '@/features/blur';
import { DictionaryPopup } from '@/features/dictionary';
import { PlaybackShortcuts } from '@/features/playback';

function StatusPill() {
  const { state } = useSession();

  let label = '';
  if (state.status === 'acquiring') label = '字幕载入中…';
  else if (state.status === 'no-captions') label = '无字幕';
  else if (state.status === 'error') label = '字幕获取失败';
  else if (state.status === 'ready' && state.translation.state === 'running') {
    label = `翻译中 ${state.translation.done}/${state.translation.total}`;
  } else if (state.status === 'ready' && state.translation.state === 'partial') {
    label = `部分翻译（${state.translation.failed} 句失败）`;
  }

  if (!label) return null;
  return (
    <div
      data-earworm-status
      role="status"
      className="pointer-events-none fixed top-4 right-4 z-[70] rounded-full bg-black/70 px-3 py-1 text-xs text-white shadow"
    >
      {label}
    </div>
  );
}

/**
 * Root of the content UI.
 *
 * The app root carries the blur attributes consumed by the T11 CSS
 * (`[data-blur-en="1"] [data-lang="en"]`, etc.); feature tickets replace the
 * stub components without touching this shell.
 */
export function ContentApp() {
  const { settings } = useSettings();

  return (
    <div
      data-earworm-root
      data-blur-en={settings.blur.en ? '1' : '0'}
      data-blur-zh={settings.blur.zh ? '1' : '0'}
      className="pointer-events-none fixed inset-0 overflow-visible"
    >
      <Overlay />
      <Sidebar />
      <BlurControls />
      <DictionaryPopup />
      <PlaybackShortcuts />
      <StatusPill />
    </div>
  );
}
