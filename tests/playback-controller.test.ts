import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPlayerController,
  type PlayerController,
} from '@/features/playback/controller';
import { FakeVideo, installManualRaf } from './mocks/video';

describe('PlayerController', () => {
  let controller: PlayerController;
  let video: FakeVideo;
  let raf: ReturnType<typeof installManualRaf>;

  beforeEach(() => {
    controller = createPlayerController();
    video = new FakeVideo();
    video.duration = 60;
    raf = installManualRaf();
  });

  afterEach(() => {
    controller.detach();
    raf.restore();
  });

  function attach(target: FakeVideo = video): void {
    controller.attach(target.asVideo());
  }

  it('seeks to the sentence start, plays, and pauses at the sentence end', () => {
    attach();

    controller.playRange(2, 4, { pauseAtEnd: true });

    expect(video.currentTime).toBe(2);
    expect(video.paused).toBe(false);
    expect(controller.isPlaying()).toBe(true);

    video.advance(3.9);
    raf.flush(2);
    expect(video.pauseCalls).toBe(0);

    video.advance(4);
    raf.flush(2);
    expect(video.pauseCalls).toBe(1);
    expect(video.paused).toBe(true);
  });

  it('clamps the end to duration - 0.05', () => {
    video.duration = 6.8;
    attach();

    controller.playRange(6, 6.8, { pauseAtEnd: true });

    video.advance(6.74);
    raf.flush(2);
    expect(video.pauseCalls).toBe(0);

    video.advance(6.76);
    raf.flush(2);
    expect(video.pauseCalls).toBe(1);
    expect(video.paused).toBe(true);
  });

  it('pauses only once per range, even after a manual resume', () => {
    attach();
    controller.playRange(0, 2, { pauseAtEnd: true });

    video.advance(2);
    raf.flush(2);
    expect(video.pauseCalls).toBe(1);

    void video.play();
    video.advance(5);
    raf.flush(2);
    expect(video.pauseCalls).toBe(1);
  });

  it('replaces the previous range when a new one starts', () => {
    attach();
    controller.playRange(0, 20, { pauseAtEnd: true });
    controller.playRange(30, 32, { pauseAtEnd: true });

    expect(video.currentTime).toBe(30);
    video.advance(20);
    raf.flush(2);
    expect(video.pauseCalls).toBe(0);

    video.advance(32);
    raf.flush(2);
    expect(video.pauseCalls).toBe(1);
  });

  it('stops a range on cancelRange', () => {
    attach();
    controller.playRange(0, 2, { pauseAtEnd: true });
    controller.cancelRange();

    video.advance(2);
    raf.flush(2);
    expect(video.pauseCalls).toBe(0);
    expect(video.paused).toBe(false);
  });

  it('cancels the range on a manual seek', () => {
    attach();
    controller.playRange(0, 10, { pauseAtEnd: true });

    video.seekTo(20);
    video.advance(21);
    raf.flush(2);

    expect(video.pauseCalls).toBe(0);
    expect(video.paused).toBe(false);
  });

  it('cancels the range on a manual pause', () => {
    attach();
    controller.playRange(0, 10, { pauseAtEnd: true });

    video.pause();
    expect(video.paused).toBe(true);

    void video.play();
    video.advance(10);
    raf.flush(2);
    expect(video.pauseCalls).toBe(1);
  });

  it('does not pause when pauseAtEnd is false', () => {
    attach();
    controller.playRange(0, 2, { pauseAtEnd: false });

    video.advance(3);
    raf.flush(2);

    expect(video.pauseCalls).toBe(0);
    expect(video.paused).toBe(false);
  });

  it('uses timeupdate as a fallback when animation frames do not run', () => {
    attach();
    controller.playRange(0, 2, { pauseAtEnd: true });

    video.advance(2);
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.pauseCalls).toBe(1);
    expect(video.paused).toBe(true);
  });

  it('treats the ended media as the final pause and does not re-pause later', () => {
    attach();
    controller.playRange(0, 10, { pauseAtEnd: true });

    video.finish();
    expect(video.ended).toBe(true);
    expect(video.paused).toBe(true);

    void video.play();
    video.advance(11);
    raf.flush(2);
    expect(video.pauseCalls).toBe(0);
  });

  it('pauses defensively when ended fires while the element still reports playing', () => {
    attach();
    controller.playRange(0, 10, { pauseAtEnd: true });

    video.paused = false;
    video.ended = true;
    video.dispatchEvent(new Event('ended'));
    expect(video.pauseCalls).toBe(1);
    expect(video.paused).toBe(true);

    video.dispatchEvent(new Event('ended'));
    expect(video.pauseCalls).toBe(1);
  });

  it('removes media listeners on detach and can attach to a new video', () => {
    attach();
    controller.playRange(0, 2, { pauseAtEnd: true });
    controller.detach();

    expect(controller.getTime()).toBe(0);
    video.advance(2);
    video.dispatchEvent(new Event('timeupdate'));
    raf.flush(2);
    expect(video.pauseCalls).toBe(0);

    const next = new FakeVideo();
    next.duration = 10;
    next.currentTime = 7;
    controller.attach(next.asVideo());
    expect(controller.getTime()).toBe(7);

    controller.playRange(5, 6, { pauseAtEnd: true });
    expect(next.currentTime).toBe(5);
    expect(next.paused).toBe(false);
    next.advance(6);
    raf.flush(2);
    expect(next.pauseCalls).toBe(1);
  });

  it('notifies subscribers of time changes and stops after unsubscribe', () => {
    attach();
    video.currentTime = 1.25;
    const seen: number[] = [];
    const unsubscribe = controller.subscribe((time) => seen.push(time));

    expect(seen).toEqual([1.25]);

    video.advance(3.5);
    video.dispatchEvent(new Event('timeupdate'));
    expect(seen.at(-1)).toBe(3.5);

    unsubscribe();
    const count = seen.length;
    video.advance(4.5);
    video.dispatchEvent(new Event('timeupdate'));
    expect(seen).toHaveLength(count);
  });

  it('seek() cancels the current range', () => {
    attach();
    controller.playRange(0, 10, { pauseAtEnd: true });

    controller.seek(20);
    expect(video.currentTime).toBe(20);

    video.advance(21);
    raf.flush(2);
    expect(video.pauseCalls).toBe(0);
  });

  it('pause() cancels the current range', () => {
    attach();
    controller.playRange(0, 10, { pauseAtEnd: true });

    controller.pause();
    expect(video.paused).toBe(true);

    void video.play();
    video.advance(10);
    raf.flush(2);
    expect(video.pauseCalls).toBe(1);
  });
});
