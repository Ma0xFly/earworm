import { createRoot } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SentenceText } from '@/features/reading/SentenceText';
import type { CollocationSpan } from '@/lib/contracts';

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

function col(
  start: number,
  end: number,
  text: string,
  source: CollocationSpan['source'] = 'offline',
): CollocationSpan {
  return { start, end, text, source };
}

describe('SentenceText', () => {
  it('renders text losslessly and marks collocations', () => {
    const container = renderSentence(
      <SentenceText text="Never give up." cols={[col(6, 13, 'give up')]} />,
    );

    expect(container.textContent).toBe('Never give up.');
    const mark = container.querySelector('mark[data-collocation]');
    expect(mark?.textContent).toBe('give up');
    expect(mark?.getAttribute('data-collocation')).toBe('offline');
    expect(mark?.getAttribute('data-start')).toBe('6');
    expect(mark?.getAttribute('data-end')).toBe('13');
    expect(container.querySelector('[data-lang="en"]')).not.toBeNull();
  });

  it('renders several collocations without losing or duplicating characters', () => {
    const container = renderSentence(
      <SentenceText
        text="Never give up now."
        cols={[col(6, 13, 'give up'), col(14, 17, 'now', 'llm')]}
      />,
    );

    expect(container.textContent).toBe('Never give up now.');
    const marks = [...container.querySelectorAll('mark[data-collocation]')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['give up', 'now']);
    expect(marks.map((mark) => mark.getAttribute('data-collocation'))).toEqual([
      'offline',
      'llm',
    ]);
  });

  it('preserves punctuation and spacing inside and around a mark', () => {
    const container = renderSentence(
      <SentenceText text={'  Give,\tup!  '} cols={[col(2, 10, 'Give,\tup')]} />,
    );

    expect(container.textContent).toBe('  Give,\tup!  ');
    expect(container.querySelector('mark')?.textContent).toBe('Give,\tup');
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

  it('keeps words inside a collocation clickable with their global index', () => {
    const onWordClick = vi.fn();
    const container = renderSentence(
      <SentenceText
        text="Never give up."
        cols={[col(6, 13, 'give up')]}
        onWordClick={onWordClick}
      />,
    );

    const up = container.querySelector<HTMLElement>('mark [data-word="up"]');
    expect(up).not.toBeNull();
    up?.click();
    expect(onWordClick).toHaveBeenCalledWith('up', 2, up);
  });

  it('fires word clicks from the keyboard', () => {
    const onWordClick = vi.fn();
    const container = renderSentence(
      <SentenceText text="Never give up." onWordClick={onWordClick} />,
    );

    const up = container.querySelector<HTMLElement>('[data-word="up"]');
    up?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(onWordClick).toHaveBeenCalledWith('up', 2, up);
  });

  it('exposes UTF-16 character offsets on word spans', () => {
    const container = renderSentence(<SentenceText text="😀 give up" />);
    const give = container.querySelector<HTMLElement>('[data-word="give"]');
    expect(give?.getAttribute('data-offset')).toBe('3');
    expect(give?.textContent).toBe('give');
  });

  it('does not render overlapping spans twice, and stays lossless', () => {
    const container = renderSentence(
      <SentenceText
        text="give up to"
        cols={[col(5, 9, 'up to'), col(0, 7, 'give up')]}
      />,
    );

    expect(container.textContent).toBe('give up to');
    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.querySelector('mark')?.textContent).toBe('give up');
    expect(container.querySelector('mark mark')).toBeNull();
  });

  it('keeps punctuation and spacing intact for Chinese text', () => {
    const container = renderSentence(<SentenceText text="你好，世界。" lang="zh" />);
    expect(container.textContent).toBe('你好，世界。');
    expect(container.querySelector('[data-lang="zh"]')).not.toBeNull();
    expect(container.querySelector('[data-word]')).toBeNull();
  });

  it('renders empty text', () => {
    const container = renderSentence(<SentenceText text="" />);
    expect(container.textContent).toBe('');
  });
});
