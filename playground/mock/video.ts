/**
 * Mock `<video>` element for the playground (T14).
 *
 * The real T10 controller and T13 session talk to a genuine
 * `HTMLVideoElement`, so instead of mocking the controller we override the
 * element instance: `currentTime`, `paused`, `duration`, `ended`, `play()` and
 * `pause()` are backed by {@link MockPlayhead} and advanced from
 * `requestAnimationFrame`. Media events (`play` / `pause` / `seeking` /
 * `seeked` / `timeupdate` / `ended`) are dispatched exactly where the browser
 * would dispatch them, so range playback and current-sentence sync really run.
 */

import { MockPlayhead, type PlayheadTick } from './clock';

export type MockVideoState = {
  time: number;
  duration: number;
  paused: boolean;
  ended: boolean;
};

export type MockVideoHandle = {
  video: HTMLVideoElement;
  playhead: MockPlayhead;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  state: () => MockVideoState;
  subscribe: (listener: (state: MockVideoState) => void) => () => void;
  dispose: () => void;
};

export type MockVideoOptions = {
  /** Mock media duration in seconds (defaults to the playhead duration). */
  duration: number;
  /** `timeupdate` cadence in ms; browsers fire roughly 4–66 Hz. */
  timeUpdateIntervalMs?: number;
};

type OverriddenProperty = 'duration' | 'currentTime' | 'paused' | 'ended' | 'seeking' | 'play' | 'pause';

const OVERRIDDEN_PROPERTIES: readonly OverriddenProperty[] = [
  'duration',
  'currentTime',
  'paused',
  'ended',
  'seeking',
  'play',
  'pause',
];

function readState(playhead: MockPlayhead): MockVideoState {
  return {
    time: playhead.time,
    duration: playhead.duration,
    paused: playhead.paused,
    ended: playhead.ended,
  };
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Install the mock clock on a real `<video>` element.
 *
 * The element must be in the document; callers keep the returned handle for
 * playback control and call `dispose()` on teardown.
 */
export function installMockVideo(
  video: HTMLVideoElement,
  options: MockVideoOptions,
): MockVideoHandle {
  const playhead = new MockPlayhead(options.duration);
  const timeUpdateIntervalMs = Math.max(16, options.timeUpdateIntervalMs ?? 100);
  const listeners = new Set<(state: MockVideoState) => void>();

  let frame = 0;
  let lastTimeUpdateMs = 0;
  let disposed = false;

  const notify = (): void => {
    const state = readState(playhead);
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // A UI subscriber must never be able to break playback.
      }
    }
  };

  const tick = (nowMs: number): void => {
    frame = 0;
    if (disposed) return;

    const result: PlayheadTick = playhead.advance(nowMs);
    if (result === 'ended') {
      video.dispatchEvent(new Event('timeupdate'));
      video.dispatchEvent(new Event('ended'));
      notify();
      return;
    }
    if (result === 'time') {
      if (nowMs - lastTimeUpdateMs >= timeUpdateIntervalMs) {
        lastTimeUpdateMs = nowMs;
        video.dispatchEvent(new Event('timeupdate'));
      }
      notify();
    }
    if (!playhead.paused) frame = requestAnimationFrame(tick);
  };

  const ensureFrame = (): void => {
    if (disposed || frame !== 0 || playhead.paused) return;
    lastTimeUpdateMs = 0;
    frame = requestAnimationFrame(tick);
  };

  const cancelFrame = (): void => {
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const pauseNow = (): void => {
    if (!playhead.pause()) return;
    cancelFrame();
    video.dispatchEvent(new Event('pause'));
    notify();
  };

  const playNow = (): void => {
    if (!playhead.play()) return;
    video.dispatchEvent(new Event('play'));
    notify();
    ensureFrame();
  };

  const seekNow = (seconds: number): void => {
    if (!playhead.seek(seconds)) return;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));
    notify();
    ensureFrame();
  };

  const overrides: Array<[OverriddenProperty, PropertyDescriptor]> = [
    ['duration', { configurable: true, get: () => playhead.duration }],
    [
      'currentTime',
      {
        configurable: true,
        get: () => playhead.time,
        set: (value: number) => {
          // Ignore the browser's own NaN/default assignment paths.
          if (typeof value === 'number') seekNow(value);
        },
      },
    ],
    ['paused', { configurable: true, get: () => playhead.paused }],
    ['ended', { configurable: true, get: () => playhead.ended }],
    ['seeking', { configurable: true, get: () => false }],
    [
      'play',
      {
        configurable: true,
        writable: true,
        value: (): Promise<void> => {
          playNow();
          return Promise.resolve();
        },
      },
    ],
    [
      'pause',
      {
        configurable: true,
        writable: true,
        value: (): void => {
          pauseNow();
        },
      },
    ],
  ];

  const previousDescriptors = new Map<OverriddenProperty, PropertyDescriptor | undefined>();
  for (const [name] of overrides) {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(video, name));
  }
  for (const [name, descriptor] of overrides) {
    Object.defineProperty(video, name, descriptor);
  }

  return {
    video,
    playhead,
    play: playNow,
    pause: pauseNow,
    toggle: () => {
      if (playhead.paused) playNow();
      else pauseNow();
    },
    seek: seekNow,
    state: () => readState(playhead),
    subscribe(listener) {
      listeners.add(listener);
      listener(readState(playhead));
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      cancelFrame();
      listeners.clear();
      for (const name of OVERRIDDEN_PROPERTIES) {
        const previous = previousDescriptors.get(name);
        if (previous) Object.defineProperty(video, name, previous);
        else Reflect.deleteProperty(video, name);
      }
    },
  };
}

function elementById<T extends HTMLElement>(id: string): T | null {
  const element = document.getElementById(id);
  return element instanceof HTMLElement ? (element as T) : null;
}

/**
 * Wire the mock player's control bar (play/pause, seek bar, time labels) to
 * the mock element. Styling and markup live in `index.html` + `playground.css`.
 */
export function bindMockPlayerControls(
  player: MockVideoHandle,
  doc: Document = document,
): () => void {
  const toggleButton = elementById<HTMLButtonElement>('ew-play-toggle');
  const playIcon = doc.getElementById('ew-play-icon');
  const currentLabel = doc.getElementById('ew-time-current');
  const totalLabel = doc.getElementById('ew-time-total');
  const progress = elementById<HTMLDivElement>('ew-progress');
  const progressFill = doc.getElementById('ew-progress-fill');

  const cleanups: Array<() => void> = [];

  const onToggle = (): void => {
    player.toggle();
  };
  toggleButton?.addEventListener('click', onToggle);
  if (toggleButton) cleanups.push(() => toggleButton.removeEventListener('click', onToggle));

  const seekFromClientX = (clientX: number): void => {
    if (!progress) return;
    const rect = progress.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    player.seek(ratio * player.state().duration);
  };

  const onProgressClick = (event: MouseEvent): void => {
    event.stopPropagation();
    seekFromClientX(event.clientX);
  };
  progress?.addEventListener('click', onProgressClick);
  if (progress) cleanups.push(() => progress.removeEventListener('click', onProgressClick));

  const onProgressKeydown = (event: KeyboardEvent): void => {
    const { time, duration } = player.state();
    let target: number | null = null;
    if (event.key === 'ArrowLeft') target = time - 5;
    else if (event.key === 'ArrowRight') target = time + 5;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = duration;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    player.seek(target);
  };
  progress?.addEventListener('keydown', onProgressKeydown);
  if (progress) {
    cleanups.push(() => progress.removeEventListener('keydown', onProgressKeydown));
  }

  const unsubscribe = player.subscribe((state) => {
    if (playIcon) playIcon.textContent = state.paused ? '▶' : '❚❚';
    if (currentLabel) currentLabel.textContent = formatTime(state.time);
    if (totalLabel) totalLabel.textContent = formatTime(state.duration);
    if (progressFill) {
      progressFill.style.width = `${Math.min(100, Math.max(0, state.time / state.duration * 100))}%`;
    }
    if (progress) {
      progress.setAttribute('aria-valuenow', String(Math.round(state.time)));
      progress.setAttribute('aria-valuemax', String(Math.round(state.duration)));
    }
  });

  return () => {
    unsubscribe();
    for (const cleanup of cleanups) cleanup();
  };
}

/**
 * Clicking the video surface toggles playback (as on YouTube), while clicks on
 * the control bar keep their own behaviour.
 */
export function bindPlayerSurfaceClick(
  player: MockVideoHandle,
  playerElement: Element,
): () => void {
  const onClick = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.closest('.ytp-chrome-bottom')) return;
    player.toggle();
  };
  playerElement.addEventListener('click', onClick);
  return () => playerElement.removeEventListener('click', onClick);
}
