import { describe, expect, it, vi } from 'vitest';
import { watchSystemDark } from '@/lib/theme/system-dark';

type FakeQuery = {
  matches: boolean;
  listeners: Set<() => void>;
};

function fakeQuery(matches: boolean): FakeQuery {
  return { matches, listeners: new Set() };
}

function asQuery(query: FakeQuery) {
  return {
    get matches() {
      return query.matches;
    },
    addEventListener: vi.fn((_type: 'change', listener: () => void) => {
      query.listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
      query.listeners.delete(listener);
    }),
  };
}

describe('options system theme', () => {
  it('applies .dark on load and follows OS theme changes', () => {
    const root = document.createElement('div');
    const query = fakeQuery(false);
    const media = asQuery(query);

    const stop = watchSystemDark(root, media);
    expect(root.classList.contains('dark')).toBe(false);

    query.matches = true;
    for (const listener of query.listeners) listener();
    expect(root.classList.contains('dark')).toBe(true);

    query.matches = false;
    for (const listener of query.listeners) listener();
    expect(root.classList.contains('dark')).toBe(false);

    stop();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('applies .dark immediately when the OS starts in dark mode', () => {
    const root = document.createElement('div');
    const stop = watchSystemDark(root, asQuery(fakeQuery(true)));
    expect(root.classList.contains('dark')).toBe(true);
    stop();
  });
});
