import { useSettings } from '@/lib/settings';
import { Overlay } from '@/features/overlay';
import { Sidebar } from '@/features/sidebar';
import { BlurStyles, blurDataAttributes } from '@/features/blur';
import { DictionaryPopup } from '@/features/dictionary';
import { PlaybackShortcuts } from '@/features/playback';
import { QuickToggle } from '@/features/quick-toggle';

/**
 * Root of the content UI.
 *
 * The app root carries the blur attributes consumed by the blur stylesheet
 * (`[data-blur-en="1"] [data-lang="en"]`, etc.). The quick toggle is always
 * mounted: its single click flips the persisted global switch, which hides the
 * learning UI (overlay, sidebar, dictionary), restores native captions (the
 * Overlay suppression effect cleans up on unmount) and lets a/s/d yield.
 */
export function ContentApp() {
  const { settings } = useSettings();
  const blurAttributes = blurDataAttributes(settings.blur);
  const enabled = settings.ui.enabled;

  return (
    <div
      data-earworm-root
      {...blurAttributes}
      data-earworm-enabled={enabled ? '1' : '0'}
      className="pointer-events-none fixed inset-0 overflow-visible"
    >
      <BlurStyles />
      <QuickToggle />
      {enabled ? (
        <>
          <Overlay />
          <Sidebar />
          <DictionaryPopup />
        </>
      ) : null}
      <PlaybackShortcuts enabled={enabled} />
    </div>
  );
}
