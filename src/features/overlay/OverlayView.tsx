/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: content.js overlay and caption lifecycle).
 * Full upstream MIT permission text: see NOTICE.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { SessionState } from '@/features/session';
import { SentenceText } from '@/features/reading/SentenceText';
import { SESSION_STATUS_TEXT } from '@/lib/ui/status-text';
import {
  computeFontSizePx,
  computeMaxWidthPx,
  computeOverlayAnchor,
  type OverlayPosition,
} from './position';

export type OverlayViewProps = {
  state: SessionState;
  position?: OverlayPosition;
  /** YouTube is playing an ad; paint nothing. */
  adPlaying?: boolean;
  /** A SPA navigation happened and the new session state has not arrived. */
  stale?: boolean;
  /** Control-bar lift in CSS pixels (bottom preset only). */
  liftPx?: number;
  /** Measured player width; 0 before T1 publishes the rect. */
  playerWidth?: number;
  onRetry?: () => void;
  /** How long the no-captions notice stays visible before fading. */
  noCaptionsFadeMs?: number;
};

/** CSS the shadow root cannot express through Tailwind on a child component. */
const WORD_INTERACTION_CSS = `
[data-ew-overlay] [data-word] {
  pointer-events: auto;
  cursor: pointer;
}
`;

const NO_CAPTIONS_FADE_MS = 6000;

const pillStyle: CSSProperties = {
  display: 'inline-block',
  maxWidth: '100%',
  padding: '2px 10px',
  borderRadius: 4,
  background: 'rgba(8, 8, 8, 0.55)',
  color: '#fff',
  fontWeight: 600,
  lineHeight: 1.25,
  textShadow: '0 1px 2px rgba(0, 0, 0, 0.9)',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
};

const statusPillStyle: CSSProperties = {
  ...pillStyle,
  fontWeight: 500,
  fontSize: '0.85em',
  background: 'rgba(8, 8, 8, 0.7)',
  transition: 'opacity 400ms ease',
};

function useAutoFade(durationMs: number): boolean {
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    setFaded(false);
    const timer = setTimeout(() => setFaded(true), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  return faded;
}

function NoCaptionsNotice({ fadeMs }: { fadeMs: number }) {
  const faded = useAutoFade(fadeMs);
  return (
    <div
      data-ew-status="no-captions"
      data-faded={faded ? '1' : undefined}
      role="status"
      style={{
        ...statusPillStyle,
        opacity: faded ? 0 : 1,
      }}
    >
      {SESSION_STATUS_TEXT.noCaptions}
    </div>
  );
}

function LoadingNotice() {
  return (
    <div data-ew-status="acquiring" role="status" style={statusPillStyle}>
      {SESSION_STATUS_TEXT.acquiring}
    </div>
  );
}

function ErrorNotice({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      data-ew-status="error"
      role="alert"
      style={{
        ...statusPillStyle,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'auto',
      }}
    >
      <span>{SESSION_STATUS_TEXT.error}</span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          border: '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: 3,
          background: 'transparent',
          color: '#fff',
          cursor: 'pointer',
          font: 'inherit',
          padding: '0 6px',
        }}
      >
        重试
      </button>
    </div>
  );
}

/**
 * Presentational bilingual subtitle layer.
 *
 * Rendered inside the T1 shadow root; every position consumes the
 * `--ew-player-*` variables published by `startPlayerRectSync`, so theater,
 * fullscreen and normal mode need no separate layout branch. Kept free of
 * session/player subscriptions so the playground (T14) can render it with
 * plain props.
 */
export function OverlayView({
  state,
  position = 'bottom',
  adPlaying = false,
  stale = false,
  liftPx = 0,
  playerWidth = 0,
  onRetry,
  noCaptionsFadeMs = NO_CAPTIONS_FADE_MS,
}: OverlayViewProps) {
  // Ads and SPA transitions must clear the last painted sentence rather than
  // leaving it over the ad or the next video.
  if (adPlaying || stale) return null;

  if (state.status === 'idle') return null;

  const sentence = state.sentences[state.currentIndex];
  const showSentence = state.status === 'ready' && sentence !== undefined;

  if (
    !showSentence &&
    state.status !== 'acquiring' &&
    state.status !== 'no-captions' &&
    state.status !== 'error'
  ) {
    return null;
  }

  const anchor = computeOverlayAnchor(position, liftPx);
  const fontSize = computeFontSizePx(playerWidth);
  const maxWidth =
    playerWidth > 0 ? computeMaxWidthPx(playerWidth) : 'min(92vw, 1100px)';

  const rootStyle: CSSProperties = {
    position: 'fixed',
    left: anchor.left,
    top: anchor.top,
    transform: anchor.transform,
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: 'max-content',
    maxWidth,
    pointerEvents: 'none',
    textAlign: 'center',
    fontSize,
    transition: 'top 180ms ease',
  };

  return (
    <div
      data-ew-overlay=""
      data-ew-position={position}
      data-ew-state={showSentence ? 'sentence' : state.status}
      role="region"
      aria-label="双语字幕"
      style={rootStyle}
    >
      <style>{WORD_INTERACTION_CSS}</style>

      {showSentence && sentence ? (
        <>
          <div data-ew-line="en" style={pillStyle}>
            <SentenceText text={sentence.text} cols={sentence.cols} lang="en" />
          </div>
          {sentence.zh ? (
            <div
              data-ew-line="zh"
              data-lang="zh"
              lang="zh-CN"
              dir="auto"
              style={{ ...pillStyle, fontSize: '0.92em' }}
            >
              {sentence.zh}
            </div>
          ) : null}
        </>
      ) : null}

      {state.status === 'acquiring' ? <LoadingNotice /> : null}
      {state.status === 'no-captions' ? (
        <NoCaptionsNotice fadeMs={noCaptionsFadeMs} />
      ) : null}
      {state.status === 'error' ? <ErrorNotice onRetry={onRetry} /> : null}
    </div>
  );
}
