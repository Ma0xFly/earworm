/**
 * Playground scenes (T14).
 *
 * Each scene gets its own `videoId`, so switching scenes exercises the real
 * YouTube SPA-navigation path: `history` changes, `yt-navigate-finish` fires,
 * the transcript client re-produces and T13's session resets/re-acquires for
 * the new video. No component state is faked or poked directly.
 */

export type SceneId = 'normal' | 'no-captions' | 'translate-failed' | 'cache-hit';

export type SceneDefinition = {
  id: SceneId;
  label: string;
  /** One-line explanation shown in the dev toolbar. */
  note: string;
  /** URL `v=` value; also the `videoId` in the injected cue payloads. */
  videoId: string;
  title: string;
  channel: string;
};

export const NORMAL_SCENE: SceneDefinition = {
  id: 'normal',
  label: '正常',
  note: '完整双语流程；第 7 句首次翻译失败，可在快捷菜单点「全部重试」恢复。',
  videoId: 'ew-playground-normal',
  title: 'Earworm 离线 Playground：用字幕学英语',
  channel: 'Earworm Dev',
};

export const NO_CAPTIONS_SCENE: SceneDefinition = {
  id: 'no-captions',
  label: '无字幕',
  note: 'mock inject 返回 cues-failed（no-captions）：overlay 显示「无字幕」，视频照常播放。',
  videoId: 'ew-playground-nocap',
  title: '无字幕视频：降级状态演示',
  channel: 'Earworm Dev',
};

export const TRANSLATE_FAILED_SCENE: SceneDefinition = {
  id: 'translate-failed',
  label: '翻译失败',
  note: 'mock background 让第一批翻译请求失败；点「全部重试」后第二次请求成功。',
  videoId: 'ew-playground-fail',
  title: '翻译失败：保留英文与重试入口',
  channel: 'Earworm Dev',
};

export const CACHE_HIT_SCENE: SceneDefinition = {
  id: 'cache-hit',
  label: '缓存命中',
  note: 'mock 缓存预置了完整译文：get-cached 命中，翻译请求数保持 0。',
  videoId: 'ew-playground-cache',
  title: '缓存命中：零翻译请求',
  channel: 'Earworm Dev',
};

export const SCENES: readonly SceneDefinition[] = [
  NORMAL_SCENE,
  NO_CAPTIONS_SCENE,
  TRANSLATE_FAILED_SCENE,
  CACHE_HIT_SCENE,
];

export function sceneById(id: string | null | undefined): SceneDefinition {
  return SCENES.find((scene) => scene.id === id) ?? NORMAL_SCENE;
}

export function sceneFromSearch(search: string): SceneDefinition {
  return sceneById(new URLSearchParams(search).get('scene'));
}

export function sceneFromLocation(location: Pick<Location, 'search'> = window.location): SceneDefinition {
  return sceneFromSearch(location.search);
}

/** URL of a scene: both the scene id and the mock `videoId`. */
export function sceneUrl(scene: SceneDefinition): string {
  const params = new URLSearchParams();
  params.set('scene', scene.id);
  params.set('v', scene.videoId);
  return `?${params.toString()}`;
}

function setMetaContent(selector: string, content: string): void {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) element.setAttribute('content', content);
}

function setText(selector: string, text: string): void {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

/**
 * Mirror the active scene into the mock watch page. T13's `readVideoMeta()`
 * reads the title/author meta tags, and the prompt context follows the scene.
 */
export function syncSceneDocument(scene: SceneDefinition): void {
  document.title = `${scene.title} - YouTube`;
  setMetaContent('meta[name="title"]', scene.title);
  setMetaContent('meta[name="author"]', scene.channel);
  setText('#video-title', scene.title);
  setText('#video-channel', scene.channel);
}

const SCENE_EVENT = 'earworm-playground:scene';

function announceScene(scene: SceneDefinition): void {
  window.dispatchEvent(new CustomEvent<SceneId>(SCENE_EVENT, { detail: scene.id }));
}

/** Subscribe to scene changes (buttons and browser history alike). */
export function onSceneChange(listener: (scene: SceneDefinition) => void): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<SceneId>).detail;
    listener(sceneById(detail));
  };
  window.addEventListener(SCENE_EVENT, handler);
  return () => window.removeEventListener(SCENE_EVENT, handler);
}

/**
 * Make sure the URL names a scene + its videoId. Called on first load and on
 * `popstate`; never dispatches navigation itself.
 */
export function ensureSceneUrl(): SceneDefinition {
  const params = new URLSearchParams(window.location.search);
  const scene = sceneFromSearch(window.location.search);
  if (params.get('scene') !== scene.id || params.get('v') !== scene.videoId) {
    window.history.replaceState({ scene: scene.id }, '', sceneUrl(scene));
  }
  syncSceneDocument(scene);
  return scene;
}

/**
 * Switch scenes through the same path a YouTube SPA navigation takes:
 * update the URL, rewrite the page metadata, then fire `yt-navigate-finish`
 * so T13's session and T3's transcript client reset and re-acquire.
 */
export function navigateToScene(
  scene: SceneDefinition,
  options: { push?: boolean } = {},
): void {
  const url = sceneUrl(scene);
  if (options.push) {
    window.history.pushState({ scene: scene.id }, '', url);
  } else {
    window.history.replaceState({ scene: scene.id }, '', url);
  }
  syncSceneDocument(scene);
  document.dispatchEvent(new Event('yt-navigate-finish', { bubbles: true }));
  announceScene(scene);
}
