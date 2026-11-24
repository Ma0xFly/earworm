import { useCallback } from 'react';
import { useSettings } from '@/lib/settings';

/** Subtitle languages whose blur can be toggled independently. */
export type BlurLanguage = 'en' | 'zh';

/** Settings-backed blur state plus writers used by {@link BlurControls}. */
export type UseBlur = {
  blur: { en: boolean; zh: boolean };
  setBlur: (language: BlurLanguage, enabled: boolean) => void;
};

/**
 * Bind the blur switches to `settings.blur`.
 *
 * Writes go through `useSettings().set({ blur })`, so persistence, storage
 * events and the root `data-blur-en` / `data-blur-zh` attributes (owned by
 * `ContentApp`) all stay in sync without local component state.
 */
export function useBlur(): UseBlur {
  const { settings, set } = useSettings();

  const setBlur = useCallback(
    (language: BlurLanguage, enabled: boolean): void => {
      set({ blur: language === 'en' ? { en: enabled } : { zh: enabled } });
    },
    [set],
  );

  return { blur: settings.blur, setBlur };
}
