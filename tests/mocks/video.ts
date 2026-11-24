import { vi } from 'vitest';

/**
 * Minimal `HTMLVideoElement` double for playback tests.
 *
 * - `advance(t)` moves the playhead like playback does (no seek events).
 * - the `currentTime` setter models a user seek: `seeking`/`seeked` events.
 * - `play()`/`pause()` dispatch the matching media events.
 */
export class FakeVideo extends EventTarget {
  duration = Number.NaN;
  paused = true;
  ended = false;
  seeking = false;
  playCalls = 0;
  pauseCalls = 0;
  private time = 0;

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    if (value === this.time) return;
    this.seeking = true;
    this.time = value;
    this.dispatchEvent(new Event('seeking'));
    this.seeking = false;
    this.dispatchEvent(new Event('seeked'));
  }

  /** Move the playhead as if the media had played for a while. */
  advance(time: number): void {
    this.time = time;
  }

  /** Simulate the user (or YouTube) seeking. */
  seekTo(time: number): void {
    this.currentTime = time;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    if (this.paused) {
      this.paused = false;
      this.ended = false;
      this.dispatchEvent(new Event('play'));
    }
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    if (!this.paused) {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }

  /** Simulate reaching the end of the media. */
  finish(): void {
    this.time = this.duration;
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event('ended'));
  }

  asVideo(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

type RafHandle = { id: number; callback: FrameRequestCallback };

/**
 * Deterministic `requestAnimationFrame` stub: callbacks only run on `flush()`.
 */
export function installManualRaf() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    pending.delete(id);
  });

  const run = (): void => {
    const batch: RafHandle[] = [...pending].map(([id, callback]) => ({ id, callback }));
    pending.clear();
    for (const { callback } of batch) callback(0);
  };

  return {
    /** Run `times` animation frames (each frame runs the callbacks queued before it). */
    flush(times = 1): void {
      for (let i = 0; i < times; i += 1) run();
    },
    pending(): number {
      return pending.size;
    },
    restore(): void {
      vi.unstubAllGlobals();
    },
  };
}
