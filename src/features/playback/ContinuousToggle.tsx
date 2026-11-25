/**
 * Continuous playback switch (spec §6 F3, §8.2).
 *
 * v1.1 removed the in-page subtitle panel, which deleted the only
 * continuous-playback control and left just the options-page default. This
 * switch restores it at the player's right edge (Language Reactor's AP slot),
 * inside the body-level shadow root so SPA navigation and player rebuilds do
 * not unmount it.
 *
 * Position comes from the `--ew-player-*` geometry variables published by the
 * shadow UI; the control is vertically centred on the right edge, clear of the
 * fullscreen button's hot zone at the bottom-right.
 */
import type { CSSProperties, SyntheticEvent } from 'react';
import { useSession } from '@/features/session';
import { useSettings } from '@/lib/settings';

const TOGGLE_STYLE: CSSProperties = {
  position: 'fixed',
  left: 'calc(var(--ew-player-left) + var(--ew-player-width) - 12px)',
  top: 'calc(var(--ew-player-top) + var(--ew-player-height) / 2)',
  transform: 'translate(-100%, -50%)',
  zIndex: 70,
  pointerEvents: 'auto',
};

const TOGGLE_CLASS =
  'inline-flex items-center gap-1.5 rounded-[8px] border border-violet-6 bg-popover/95 px-2 py-1 text-[11px] font-semibold text-popover-foreground shadow-lg outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50';

function stopPlayerEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

/** Toggle 连续播放; the persisted setting is the single source of truth. */
export function ContinuousToggle() {
  const { settings, set } = useSettings();
  const { setContinuous } = useSession();
  const continuous = settings.playback.continuous;

  const toggle = (): void => {
    const next = !continuous;
    set({ playback: { continuous: next } });
    setContinuous(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={continuous}
      aria-label="连续播放"
      data-earworm-continuous-toggle=""
      data-on={continuous ? 'true' : 'false'}
      title={continuous ? '连续播放：开（句尾不暂停）' : '连续播放：关（句尾暂停）'}
      className={TOGGLE_CLASS}
      style={TOGGLE_STYLE}
      onClick={(event) => {
        stopPlayerEvent(event);
        toggle();
      }}
      onPointerDown={stopPlayerEvent}
      onDoubleClick={stopPlayerEvent}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-muted-foreground data-[on=true]:bg-primary"
        data-on={continuous ? 'true' : 'false'}
      />
      连续
    </button>
  );
}
