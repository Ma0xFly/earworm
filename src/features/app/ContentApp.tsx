import { useSettings } from '@/lib/settings';
import { Overlay } from '@/features/overlay';
import { BlurStyles, blurDataAttributes } from '@/features/blur';
import { DictionaryPopup } from '@/features/dictionary';
import { ContinuousToggle, PlaybackShortcuts } from '@/features/playback';
import { QuickToggle } from '@/features/quick-toggle';

/**
 * Root of the content UI.
 *
 * The app root carries the blur attributes consumed by the blur stylesheet
 * (`[data-blur-en="1"] [data-lang="en"]`, etc.). The quick toggle is always
 * mounted: its single click flips the persisted global switch, which hides the
 * learning UI (overlay, dictionary), restores native captions (the Overlay
 * suppression effect cleans up on unmount) and lets a/s/d yield.
 */
export function ContentApp() {
  const { settings } = useSettings();
  const blurAttributes = blurDataAttributes(settings.blur);
  const enabled = settings.ui.enabled;

  return (
    <div
      data-earworm-root
      {...blurAttributes}
      className="pointer-events-none fixed inset-0 overflow-visible"
    >
      <BlurStyles />
      <QuickToggle />
      {enabled ? (
        <>
          <ContinuousToggle />
          <Overlay />
          <DictionaryPopup />
        </>
      ) : null}
      <PlaybackShortcuts enabled={enabled} />
    </div>
  );
}
