/**
 * a / s / d sentence shortcuts.
 *
 * Mounted once by `ContentApp` next to the overlay/sidebar. Besides the key
 * handler it owns the controller attach lifecycle: it keeps the singleton
 * `playerController` attached to the current watch-page video across YouTube
 * SPA navigation. Keydown is the only handled event; a/s/d are dispatched
 * through the session API so T13 retains ownership of the continuous-mode
 * playback semantics.
 */

import { useEffect, useRef } from 'react';
import { useSession } from '@/features/session';
import { startPlayerControllerSync } from './attach';
import { playerController } from './controller';
import { handleShortcutKey } from './keyboard';

export function PlaybackShortcuts({ enabled = true }: { enabled?: boolean } = {}): null {
  const session = useSession();
  const latestSession = useRef(session);
  const latestEnabled = useRef(enabled);
  useEffect(() => {
    latestSession.current = session;
    latestEnabled.current = enabled;
  });

  // Attach/detach the controller with the content-script lifecycle and follow
  // YouTube SPA navigation without re-registering anything per navigation.
  useEffect(() => startPlayerControllerSync(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const current = latestSession.current;
      handleShortcutKey(event, {
        sentences: current.state.sentences,
        currentIndex: current.state.currentIndex,
        time: playerController.getTime(),
        seekToSentence: current.seekToSentence,
        enabled: latestEnabled.current,
      });
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return null;
}
