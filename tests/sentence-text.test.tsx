import { createRoot } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SentenceText } from '@/features/reading/SentenceText';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function renderSentence(element: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('SentenceText scaffold', () => {
  it('renders text losslessly and marks collocations', () => {
    const container = renderSentence(
      <SentenceText
        text="Never give up."
        cols={[{ start: 6, end: 13, text: 'give up', source: 'offline' }]}
      />,
    );

    expect(container.textContent).toBe('Never give up.');
    const mark = container.querySelector('mark[data-collocation]');
    expect(mark?.textContent).toBe('give up');
    expect(mark?.getAttribute('data-collocation')).toBe('offline');
    expect(container.querySelector('[data-lang="en"]')).not.toBeNull();
  });

  it('reports word clicks with the surface form, word index and element', () => {
    const onWordClick = vi.fn();
    const container = renderSentence(
      <SentenceText text="Never give up." onWordClick={onWordClick} />,
    );

    const give = container.querySelector<HTMLElement>('[data-word="give"]');
    expect(give).not.toBeNull();
    give?.click();

    expect(onWordClick).toHaveBeenCalledTimes(1);
    const [surface, index, element] = onWordClick.mock.calls[0] ?? [];
    expect(surface).toBe('give');
    expect(index).toBe(1);
    expect(element).toBe(give);
  });

  it('keeps punctuation and spacing intact for Chinese text', () => {
    const container = renderSentence(<SentenceText text="你好，世界。" lang="zh" />);
    expect(container.textContent).toBe('你好，世界。');
    expect(container.querySelector('[data-lang="zh"]')).not.toBeNull();
  });
});
