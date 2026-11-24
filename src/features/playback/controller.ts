/**
 * Player controller: sentence-range playback on the YouTube `<video>`.
 *
 * Adapted for Earworm (MIT) from Nitrino/easysubs (MIT) — Copyright (c) 2022 Seo Jong Hak.
 * Adapted for Earworm (MIT) from umutgokbulak/SceneLingo (MIT) — Copyright (c) 2026 Umut.
 * Upstream: https://github.com/Nitrino/easysubs and https://github.com/umutgokbulak/SceneLingo
 * (easysubs: sentence-start previous/repeat/next seeking semantics; SceneLingo:
 * per-range latch / rAF auto-pause pattern).
 * Full upstream MIT permission texts: see NOTICE.
 *
 * Behaviour:
 * - rAF is the primary clock; `timeupdate` is the fallback when frames are
 *   throttled (background tab, hidden element).
 * - `playRange(start, end)` seeks to `start`, plays, and pauses once when the
 *   playhead reaches `end`. `end` is clamped to `duration - 0.05` so the last
 *   sentence of a video can pause before the `ended` boundary.
 * - A sentence range covers merged cues, so its end is already the maximum of
 *   the covered cue ends; evaluating the single active range per frame is the
 *   sentence-level form of the "pause at max(active cue ends)" rule.
 * - A new range replaces the old one. A manual seek/pause cancels the range;
 *   a seek caused by the controller itself (`playRange` / `seek`) does not.
 * - `seeking` resets the latch and re-evaluates the active range.
 */

export type PlayRangeOptions = { pauseAtEnd: boolean };

export interface PlayerController {
  attach(video: HTMLVideoElement): void;
  detach(): void;
  getTime(): number;
  isPlaying(): boolean;
  seek(t: number): void;
  play(): void;
  pause(): void;
  playRange(start: number, end: number, opts: PlayRangeOptions): void;
  cancelRange(): void;
  subscribe(cb: (time: number) => void): () => void;
}

/** The last-frame clamp keeps the final sentence just short of `ended`. */
const END_EPSILON = 0.05;
const TIME_EPSILON = 1e-4;

type ActiveRange = {
  start: number;
  /** Unclamped requested end; duration is applied on evaluation. */
  end: number;
  pauseAtEnd: boolean;
  /** One-shot latch: this range has already paused (or the video ended). */
  latched: boolean;
};

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

class PlaybackController implements PlayerController {
  private video: HTMLVideoElement | null = null;
  private range: ActiveRange | null = null;
  private readonly subscribers = new Set<(time: number) => void>();
  private frame = 0;
  /** True between a controller-originated `currentTime` write and `seeking`. */
  private internalSeek = false;
  /** True between a controller-originated `pause()` and its `pause` event. */
  private expectedPause = false;
  private lastEmitted = Number.NaN;

  attach(video: HTMLVideoElement): void {
    if (!video || this.video === video) return;
    this.detach();
    this.video = video;

    video.addEventListener('timeupdate', this.onTimeUpdate);
    video.addEventListener('seeking', this.onSeeking);
    video.addEventListener('seeked', this.onSeeked);
    video.addEventListener('pause', this.onPause);
    video.addEventListener('play', this.onPlay);
    video.addEventListener('ended', this.onEnded);
    video.addEventListener('durationchange', this.onDurationChange);

    this.notify();
    if (!video.paused) this.schedule();
  }

  detach(): void {
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    const video = this.video;
    if (video) {
      video.removeEventListener('timeupdate', this.onTimeUpdate);
      video.removeEventListener('seeking', this.onSeeking);
      video.removeEventListener('seeked', this.onSeeked);
      video.removeEventListener('pause', this.onPause);
      video.removeEventListener('play', this.onPlay);
      video.removeEventListener('ended', this.onEnded);
      video.removeEventListener('durationchange', this.onDurationChange);
    }
    this.video = null;
    this.range = null;
    this.internalSeek = false;
    this.expectedPause = false;
    this.lastEmitted = Number.NaN;
  }

  getTime(): number {
    return this.video?.currentTime ?? 0;
  }

  isPlaying(): boolean {
    const video = this.video;
    return video ? !video.paused && !video.ended : false;
  }

  /** Explicit navigation: cancels the active sentence range. */
  seek(t: number): void {
    this.cancelRange();
    this.seekInternal(t);
  }

  play(): void {
    const video = this.video;
    if (!video) return;
    const result = video.play() as Promise<void> | undefined;
    result?.catch?.(() => {
      // Autoplay rejection must never break the content script.
    });
  }

  /** Explicit pause: cancels the active sentence range. */
  pause(): void {
    this.cancelRange();
    const video = this.video;
    if (!video || video.paused) return;
    this.expectedPause = true;
    video.pause();
  }

  playRange(start: number, end: number, opts: PlayRangeOptions): void {
    const video = this.video;
    if (!video || !isFiniteNumber(start) || !isFiniteNumber(end)) return;

    this.cancelRange();
    this.range = {
      start,
      end,
      pauseAtEnd: opts.pauseAtEnd,
      latched: false,
    };

    this.seekInternal(start);
    this.play();
    this.evaluateRange();
  }

  cancelRange(): void {
    this.range = null;
  }

  subscribe(cb: (time: number) => void): () => void {
    this.subscribers.add(cb);
    const time = this.getTime();
    this.lastEmitted = time;
    try {
      cb(time);
    } catch {
      // A subscriber must not be able to break playback.
    }
    if (this.video && !this.video.paused) this.schedule();
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notify(force = false): void {
    const time = this.getTime();
    if (!force && time === this.lastEmitted) return;
    this.lastEmitted = time;
    for (const cb of [...this.subscribers]) {
      try {
        cb(time);
      } catch {
        // A subscriber must not be able to break playback.
      }
    }
  }

  /** Effective end: `min(end, duration - 0.05)`, never before `start`. */
  private effectiveEnd(rawEnd: number): number {
    let end = rawEnd;
    const duration = this.video?.duration;
    if (isFiniteNumber(duration) && duration > 0) {
      end = Math.min(end, duration - END_EPSILON);
    }
    const start = this.range?.start;
    if (start !== undefined && isFiniteNumber(start)) {
      end = Math.max(end, start);
    }
    return end;
  }

  private rangeIsDue(time: number): boolean {
    const range = this.range;
    const video = this.video;
    if (!range || !range.pauseAtEnd || range.latched) return false;
    if (!video || video.paused || video.seeking || video.ended) return false;
    return time >= this.effectiveEnd(range.end) - 1e-9;
  }

  private evaluateRange(): void {
    const video = this.video;
    if (!video || !this.rangeIsDue(video.currentTime)) return;

    // Latch before pausing: the pause event and any later frames must not
    // pause a second time, even if the user resumes inside the same range.
    this.range!.latched = true;
    this.expectedPause = true;
    video.pause();
  }

  /**
   * Controller-originated seek. The `seeking` event it triggers keeps the
   * active range (and resets its latch); an external seek cancels it.
   */
  private seekInternal(time: number): void {
    const video = this.video;
    if (!video || !isFiniteNumber(time)) return;

    let target = Math.max(0, time);
    const duration = video.duration;
    if (isFiniteNumber(duration) && duration > 0) {
      target = Math.min(target, duration);
    }
    if (Math.abs(video.currentTime - target) < TIME_EPSILON) return;

    this.internalSeek = true;
    try {
      video.currentTime = target;
    } catch {
      this.internalSeek = false;
      return;
    }
    // Some players update `currentTime` synchronously without events.
    this.notify();
  }

  private schedule(): void {
    if (this.frame !== 0) return;
    const video = this.video;
    if (!video || video.paused) return;
    if (this.subscribers.size === 0 && (!this.range || this.range.latched)) return;
    if (typeof requestAnimationFrame !== 'function') return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.frame = 0;
    const video = this.video;
    if (!video) return;

    this.notify();
    this.evaluateRange();
    if (!video.paused) this.schedule();
  };

  private onTimeUpdate = (): void => {
    // Fallback clock: `timeupdate` still fires when rAF is throttled.
    this.notify();
    this.evaluateRange();
  };

  private onSeeking = (): void => {
    if (this.internalSeek) {
      this.internalSeek = false;
      // A fresh seek re-arms the latch so the new pass can pause again.
      if (this.range) this.range.latched = false;
      return;
    }
    // Manual seek: the user is driving; sentence mode ends.
    this.cancelRange();
  };

  private onSeeked = (): void => {
    this.internalSeek = false;
    this.notify();
    this.evaluateRange();
    this.schedule();
  };

  private onPause = (): void => {
    if (this.expectedPause) {
      this.expectedPause = false;
    } else {
      // Manual pause ends sentence mode.
      this.cancelRange();
    }
    this.notify();
  };

  private onPlay = (): void => {
    this.notify();
    this.schedule();
  };

  private onEnded = (): void => {
    // Reaching the end is already a pause; latch so a replay does not fire a
    // second pause at the clamped end. Pausing defensively covers players
    // that report `ended` while `paused` is still false.
    const range = this.range;
    const video = this.video;
    if (range && range.pauseAtEnd) {
      range.latched = true;
      if (video && !video.paused) {
        this.expectedPause = true;
        video.pause();
      }
    }
    this.notify();
  };

  private onDurationChange = (): void => {
    // Duration may arrive after `playRange`; re-evaluate with the real clamp.
    this.notify();
    this.evaluateRange();
  };
}

/** Create an isolated controller (tests, playgrounds). */
export function createPlayerController(): PlayerController {
  return new PlaybackController();
}

/** Singleton controller attached to the current HTMLVideoElement. */
export const playerController: PlayerController = createPlayerController();
