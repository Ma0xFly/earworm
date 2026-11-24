/**
 * Player controller (T1 no-op stub).
 *
 * T10 replaces this file with the real rAF + `timeupdate` implementation:
 * seek/play/pause, `playRange(start, end, {pauseAtEnd})`, range cancellation,
 * subscriptions and SPA re-attach. Keep the exported interface stable.
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

class NoopPlayerController implements PlayerController {
  private video: HTMLVideoElement | null = null;

  attach(video: HTMLVideoElement): void {
    this.video = video;
  }

  detach(): void {
    this.video = null;
  }

  getTime(): number {
    return this.video?.currentTime ?? 0;
  }

  isPlaying(): boolean {
    return this.video ? !this.video.paused : false;
  }

  seek(_t: number): void {
    // T10 implementation.
  }

  play(): void {
    // T10 implementation.
  }

  pause(): void {
    // T10 implementation.
  }

  playRange(_start: number, _end: number, _opts: PlayRangeOptions): void {
    // T10 implementation.
  }

  cancelRange(): void {
    // T10 implementation.
  }

  subscribe(_cb: (time: number) => void): () => void {
    return () => {};
  }
}

/** Singleton controller attached to the current HTMLVideoElement. */
export const playerController: PlayerController = new NoopPlayerController();
