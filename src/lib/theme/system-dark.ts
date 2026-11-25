/**
 * Keep a document root's `.dark` class in sync with the OS theme.
 *
 * The shared stylesheet uses a class-driven `dark` variant so the video
 * overlay can force dark, so the standalone options page mirrors the OS
 * preference here. CSS tokens also have a `prefers-color-scheme` fallback.
 */
export type DarkThemeQuery = {
  matches: boolean;
  addEventListener: (type: 'change', listener: () => void) => void;
  removeEventListener: (type: 'change', listener: () => void) => void;
};

export function watchSystemDark(root: Element, query: DarkThemeQuery): () => void {
  const apply = (): void => {
    root.classList.toggle('dark', query.matches);
  };

  apply();
  query.addEventListener('change', apply);

  return () => {
    query.removeEventListener('change', apply);
    root.classList.remove('dark');
  };
}
