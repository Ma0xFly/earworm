import { describe, expect, it } from 'vitest';
import { blurDataAttributes } from './blurAttributes';

describe('blurDataAttributes', () => {
  it('maps each independent blur switch to the stylesheet flag', () => {
    expect(blurDataAttributes({ en: true, zh: false })).toEqual({
      'data-blur-en': '1',
      'data-blur-zh': '0',
    });
    expect(blurDataAttributes({ en: false, zh: true })).toEqual({
      'data-blur-en': '0',
      'data-blur-zh': '1',
    });
    expect(blurDataAttributes({ en: false, zh: false })).toEqual({
      'data-blur-en': '0',
      'data-blur-zh': '0',
    });
    expect(blurDataAttributes({ en: true, zh: true })).toEqual({
      'data-blur-en': '1',
      'data-blur-zh': '1',
    });
  });
});
