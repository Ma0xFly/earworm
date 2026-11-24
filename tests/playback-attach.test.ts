import { afterEach, describe, expect, it } from 'vitest';
import { createPlayerController } from '@/features/playback/controller';
import { startPlayerControllerSync } from '@/features/playback/attach';
import { installManualRaf } from './mocks/video';

function createVideo(time = 0, duration = 60): HTMLVideoElement {
  const video = document.createElement('video');
  video.className = 'html5-main-video';
  Object.defineProperty(video, 'duration', {
    configurable: true,
    value: duration,
  });
  video.currentTime = time;
  document.body.appendChild(video);
  return video;
}

describe('startPlayerControllerSync', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '';
  });

  it('attaches to the current video and detaches on unmount', () => {
    const controller = createPlayerController();
    const video = createVideo(5);

    cleanup = startPlayerControllerSync({ controller });
    expect(controller.getTime()).toBe(5);

    cleanup();
    cleanup = null;
    expect(controller.getTime()).toBe(0);
    expect(video.isConnected).toBe(true);
  });

  it('detaches on yt-navigate-start and re-attaches to the new video', () => {
    const controller = createPlayerController();
    const oldVideo = createVideo(5);
    cleanup = startPlayerControllerSync({ controller });

    oldVideo.remove();
    document.dispatchEvent(new Event('yt-navigate-start'));
    expect(controller.getTime()).toBe(0);

    createVideo(7);
    document.dispatchEvent(new Event('yt-navigate-finish'));

    expect(controller.getTime()).toBe(7);
  });

  it('polls for a video that appears after the app mounts', () => {
    const raf = installManualRaf();
    const controller = createPlayerController();
    cleanup = startPlayerControllerSync({ controller });
    expect(raf.pending()).toBe(1);

    createVideo(9);
    raf.flush();

    expect(controller.getTime()).toBe(9);
    raf.restore();
  });
});
