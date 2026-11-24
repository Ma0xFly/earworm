/**
 * Pure mock playhead for the playground's fake `<video>` (T14).
 *
 * The real playback controller (T10) owns the media element, so the playground
 * cannot paint UI frames itself. Instead it overrides the element's
 * `currentTime` / `paused` / `play()` / `pause()` and advances this state
 * machine from `requestAnimationFrame`. Keeping the state machine DOM-free
 * lets `playground/smoke.ts` verify the clock without a browser.
 */

export type PlayheadTick = 'time' | 'ended' | null;

export class MockPlayhead {
  readonly duration: number;

  private timeValue = 0;
  private pausedValue = true;
  private endedValue = false;
  private lastFrameMs: number | null = null;

  constructor(durationSeconds: number) {
    this.duration =
      Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  }

  get time(): number {
    return this.timeValue;
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  get ended(): boolean {
    return this.endedValue;
  }

  get progress(): number {
    return this.duration > 0 ? this.timeValue / this.duration : 0;
  }

  /** Start playback. Returns true when the state actually changed. */
  play(): boolean {
    if (!this.pausedValue) return false;
    this.pausedValue = false;
    this.endedValue = false;
    this.lastFrameMs = null;
    return true;
  }

  /** Pause playback. Returns true when the state actually changed. */
  pause(): boolean {
    if (this.pausedValue) return false;
    this.pausedValue = true;
    this.lastFrameMs = null;
    return true;
  }

  /** Seek to `seconds`, clamped to `[0, duration]`. */
  seek(seconds: number): boolean {
    if (!Number.isFinite(seconds)) return false;
    const target = Math.min(Math.max(seconds, 0), this.duration);
    if (Math.abs(target - this.timeValue) < 1e-6) return false;
    this.timeValue = target;
    this.endedValue = false;
    // Re-baseline the next frame so a seek never jumps the playhead forward.
    this.lastFrameMs = null;
    return true;
  }

  /**
   * Advance the playhead to `nowMs` (a rAF timestamp). Returns what happened:
   * `'time'` for normal progress, `'ended'` when the clock reached the end
   * (the playhead pauses itself), or `null` for the first frame / while paused.
   */
  advance(nowMs: number): PlayheadTick {
    if (this.pausedValue || this.endedValue) {
      this.lastFrameMs = null;
      return null;
    }
    if (this.lastFrameMs === null) {
      this.lastFrameMs = nowMs;
      return null;
    }

    const deltaSeconds = Math.max(0, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;
    if (deltaSeconds === 0) return null;

    this.timeValue = Math.min(this.duration, this.timeValue + deltaSeconds);
    if (this.timeValue >= this.duration) {
      this.timeValue = this.duration;
      this.pausedValue = true;
      this.endedValue = true;
      return 'ended';
    }
    return 'time';
  }
}
