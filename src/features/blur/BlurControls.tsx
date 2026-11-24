/**
 * Independent English / Chinese subtitle blur controls (F1).
 *
 * Rendered by T1's `ContentApp` inside the body-level shadow root. The two
 * switches write `settings.blur` through {@link useBlur}; `ContentApp` mirrors
 * that state onto the root's `data-blur-en` / `data-blur-zh` attributes, which
 * the shadow stylesheet targets.
 */
import { Switch } from '@/components/ui/switch';
import { BLUR_CSS } from './blurCss';
import { useBlur } from './useBlur';

const SWITCH_LABEL_CLASS = 'select-none text-[11px] font-medium text-white/80';

export function BlurControls() {
  const { blur, setBlur } = useBlur();

  return (
    <>
      <style data-earworm-blur-css>{BLUR_CSS}</style>
      <div
        data-earworm-blur-controls
        role="group"
        aria-label="字幕模糊"
        className="pointer-events-auto fixed z-[65] flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-2.5 py-1.5 text-white shadow-lg backdrop-blur-sm"
        style={{
          left: 'calc(var(--ew-player-left, 0px) + 12px)',
          top: 'calc(var(--ew-player-top, 0px) + 12px)',
        }}
      >
        <span className="select-none px-0.5 text-[11px] text-white/50">模糊</span>
        <label htmlFor="ew-blur-en" className={SWITCH_LABEL_CLASS}>
          英
        </label>
        <Switch
          id="ew-blur-en"
          size="sm"
          checked={blur.en}
          onCheckedChange={(checked) => setBlur('en', checked)}
          aria-label="模糊英文"
        />
        <label htmlFor="ew-blur-zh" className={SWITCH_LABEL_CLASS}>
          中
        </label>
        <Switch
          id="ew-blur-zh"
          size="sm"
          checked={blur.zh}
          onCheckedChange={(checked) => setBlur('zh', checked)}
          aria-label="模糊中文"
        />
      </div>
    </>
  );
}
