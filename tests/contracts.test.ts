import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/contracts';

describe('shared contracts', () => {
  it('ships the magpie default LLM endpoint and model', () => {
    expect(DEFAULT_SETTINGS.llm.baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(DEFAULT_SETTINGS.llm.model).toBe('group/free-ds');
    expect(DEFAULT_SETTINGS.llm.apiKey).toBe('');
  });

  it('defaults blur and continuous playback to off, sidebar to on', () => {
    expect(DEFAULT_SETTINGS.blur).toEqual({ en: false, zh: false });
    expect(DEFAULT_SETTINGS.playback.continuous).toBe(false);
    expect(DEFAULT_SETTINGS.ui.sidebar).toBe(true);
    expect(DEFAULT_SETTINGS.version).toBe(1);
  });
});
