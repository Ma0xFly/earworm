import { useEffect, useState, type ReactElement } from 'react';
import { loadSettings, saveSettings, subscribeSettings } from '../src/lib/settings';
import type { MockBackend, MockStats } from './mock/background';
import {
  onSceneChange,
  SCENES,
  sceneFromLocation,
  type SceneDefinition,
} from './scene';

/**
 * Playground dev toolbar (T14). Rendered in the light DOM above the mock watch
 * page — it is a debugging affordance, not part of the extension UI.
 *
 * Scene buttons drive the real SPA-navigation path; the continuous toggle
 * writes `settings.playback.continuous` through the actual settings module, so
 * T13's session picks it up on the next seek exactly as in the extension.
 */

export type ToolbarProps = {
  backend: MockBackend;
  onSceneSelected: (scene: SceneDefinition) => void;
};

function formatStats(stats: MockStats): string {
  return [
    `缓存命中 ${stats.cacheHits}/${stats.getCached}`,
    `翻译请求 ${stats.translateBatches}`,
    `提交 ${stats.commits}`,
  ].join(' · ');
}

export function Toolbar({ backend, onSceneSelected }: ToolbarProps): ReactElement {
  const [scene, setScene] = useState<SceneDefinition>(() => sceneFromLocation());
  const [stats, setStats] = useState<MockStats>(() => backend.snapshot());
  const [continuous, setContinuous] = useState(false);

  useEffect(() => {
    return backend.subscribe(setStats);
  }, [backend]);

  useEffect(() => {
    const unsubscribe = onSceneChange(setScene);
    const onPopState = (): void => setScene(sceneFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void loadSettings()
      .then((settings) => {
        if (alive) setContinuous(settings.playback.continuous);
      })
      .catch(() => {
        // Defaults are false; storage failures must not break the toolbar.
      });
    const unsubscribe = subscribeSettings((settings) => {
      setContinuous(settings.playback.continuous);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const updateContinuous = (value: boolean): void => {
    setContinuous(value);
    void saveSettings({ playback: { continuous: value } }).catch(() => {
      // The in-memory toggle still reflects the user's intent.
    });
  };

  return (
    <>
      <div className="dev-row">
        <span className="dev-label">场景</span>
        <div className="dev-scenes" role="group" aria-label="演示场景">
          {SCENES.map((candidate) => {
            const active = candidate.id === scene.id;
            return (
              <button
                key={candidate.id}
                type="button"
                data-scene={candidate.id}
                aria-pressed={active}
                className={active ? 'dev-scene is-active' : 'dev-scene'}
                onClick={() => onSceneSelected(candidate)}
              >
                {candidate.label}
              </button>
            );
          })}
        </div>

        <label
          className="dev-toggle"
          title="关闭时每句结束自动暂停（默认）；开启时连续播放"
        >
          <input
            type="checkbox"
            checked={continuous}
            onChange={(event) => updateContinuous(event.currentTarget.checked)}
          />
          连续播放
        </label>

        <span className="dev-stats" data-playground-stats="">
          {formatStats(stats)}
        </span>

        <button
          className="dev-reload"
          type="button"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </div>

      <div className="dev-note">
        <strong>{scene.label}</strong> · {scene.note}
        <span className="dev-sep">·</span>
        快捷键 <code>a</code> / <code>s</code> / <code>d</code>
        <span className="dev-sep">·</span>
        点击右侧句子 seek
        <span className="dev-sep">·</span>
        点词查词典
        <span className="dev-sep">·</span>
        播放器左上角可分别「模糊」英 / 中字幕
      </div>
    </>
  );
}
