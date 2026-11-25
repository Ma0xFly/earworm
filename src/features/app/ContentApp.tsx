import { useSettings } from '@/lib/settings';
import { useSession } from '@/features/session';
import { Overlay } from '@/features/overlay';
import { Sidebar } from '@/features/sidebar';
import { BlurControls, blurDataAttributes } from '@/features/blur';
import { DictionaryPopup } from '@/features/dictionary';
import { PlaybackShortcuts } from '@/features/playback';

/**
 * Root of the content UI.
 *
 * The app root carries the blur attributes consumed by the T11 CSS
 * (`[data-blur-en="1"] [data-lang="en"]`, etc.); feature tickets replace the
 * stub components without touching this shell.
 */
export function ContentApp() {
  const { settings } = useSettings();
  const blurAttributes = blurDataAttributes(settings.blur);

  return (
    <div
      data-earworm-root
      {...blurAttributes}
      className="pointer-events-none fixed inset-0 overflow-visible"
    >
      <Overlay />
      <Sidebar />
      <BlurControls />
      <DictionaryPopup />
      <PlaybackShortcuts />
    </div>
  );
}
