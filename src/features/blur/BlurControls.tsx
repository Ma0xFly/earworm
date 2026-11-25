/**
 * Independent English / Chinese subtitle blur controls (F1).
 *
 * v1.1 moves the two switches into the quick menu (spec §6 F1): the old fixed
 * floating glass pill is gone. `BlurStyles` keeps emitting the blur sheet into
 * the body-level shadow root; `BlurSwitches` is the reusable switch group the
 * quick menu renders. `useBlur` still writes `settings.blur`, and `ContentApp`
 * mirrors it onto the root's `data-blur-en` / `data-blur-zh` attributes.
 */
import { Switch } from '@/components/ui/switch';
import { BLUR_CSS } from './blurCss';
import { useBlur } from './useBlur';

const SWITCH_LABEL_CLASS = 'select-none text-[11px] font-medium text-white/80';

/** The blur stylesheet lives in the shadow root, never in the page `<head>`. */
export function BlurStyles() {
  return <style data-earworm-blur-css>{BLUR_CSS}</style>;
}

/** The two blur switches hosted by the quick menu. */
export function BlurSwitches({ className }: { className?: string }) {
  const { blur, setBlur } = useBlur();

  return (
    <div
      data-earworm-blur-switches
      role="group"
      aria-label="字幕模糊"
      className={className}
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
  );
}
