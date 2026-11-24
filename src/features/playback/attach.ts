/**
 * Keeps the singleton player controller attached to the current watch-page
 * `<video>` across YouTube SPA navigation.
 *
 * Adapted for Earworm (MIT) from:
 * - easysubs (https://github.com/Nitrino/easysubs), Copyright (c) 2022 Seo
 *   Jong Hak, MIT License — YouTube adapter lifecycle.
 * See `NOTICE` for the full third-party notice.
 */

import { playerController, type PlayerController } from './controller';

/** YouTube's main video element, with a generic fallback for tests/playground. */
export function findVideoElement(root: ParentNode = document): HTMLVideoElement | null {
  return (
    root.querySelector<HTMLVideoElement>('video.html5-main-video') ??
    root.querySelector<HTMLVideoElement>('video')
  );
}

export type PlayerControllerSyncOptions = {
  controller?: PlayerController;
  doc?: Document;
  maxWaitFrames?: number;
};

/** Roughly ten seconds at 60fps; slow watch pages can take a while. */
const DEFAULT_MAX_WAIT_FRAMES = 600;

/**
 * Attach the controller now when a video exists, otherwise poll for one for a
 * short while (the app can mount before YouTube has inserted the video).
 * Re-resolves on `yt-navigate-finish` / `yt-page-data-updated`, and detaches on
 * `yt-navigate-start` so a range never survives a page transition.
 *
 * Returns a cleanup that removes every listener and detaches the controller.
 */
export function startPlayerControllerSync(
  options: PlayerControllerSyncOptions = {},
): () => void {
  const controller = options.controller ?? playerController;
  const doc = options.doc ?? document;
  const maxWaitFrames = options.maxWaitFrames ?? DEFAULT_MAX_WAIT_FRAMES;

  let disposed = false;
  let frame = 0;
  let attempts = 0;

  const attachCurrent = (): boolean => {
    const video = findVideoElement(doc);
    if (!video) return false;
    attempts = 0;
    controller.attach(video);
    return true;
  };

  const waitForVideo = (): void => {
    if (disposed) return;
    if (attachCurrent()) return;
    if (attempts >= maxWaitFrames) return;
    if (typeof requestAnimationFrame !== 'function') return;
    attempts += 1;
    frame = requestAnimationFrame(waitForVideo);
  };

  const resync = (): void => {
    if (disposed) return;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    attempts = 0;
    waitForVideo();
  };

  const onNavigateStart = (): void => {
    if (disposed) return;
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    attempts = 0;
    controller.detach();
  };

  const onNavigate = (): void => {
    resync();
  };

  const onMediaReady = (): void => {
    if (disposed) return;
    const video = findVideoElement(doc);
    if (video) controller.attach(video);
  };

  const listeners: Array<[string, EventListener]> = [
    ['yt-navigate-start', onNavigateStart],
    ['yt-navigate-finish', onNavigate],
    ['yt-page-data-updated', onNavigate],
    ['loadedmetadata', onMediaReady],
  ];
  for (const [type, listener] of listeners) {
    doc.addEventListener(type, listener, true);
  }

  waitForVideo();

  return () => {
    disposed = true;
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    for (const [type, listener] of listeners) {
      doc.removeEventListener(type, listener, true);
    }
    controller.detach();
  };
}
