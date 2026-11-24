import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/contracts';
import { normalizeSettings } from '@/lib/settings';
import {
  deriveOriginPattern,
  draftFromSettings,
  draftToPatch,
  ensureBaseUrlPermission,
  normalizeLlmForm,
  truncateSample,
  validateLlmForm,
} from '@/lib/settings/options';
import { chromeMock } from './mocks/chrome';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockContains(value: boolean) {
  return vi.spyOn(chromeMock.permissions, 'contains').mockResolvedValue(value);
}

function mockRequest(value: boolean) {
  return vi.spyOn(chromeMock.permissions, 'request').mockResolvedValue(value);
}

describe('options settings helpers', () => {
  it('merges defaults into a draft and keeps stored values', () => {
    const draft = draftFromSettings(normalizeSettings({ blur: { zh: true } }));

    expect(draft.llm).toEqual(DEFAULT_SETTINGS.llm);
    expect(draft.blur).toEqual({ en: false, zh: true });
    expect(draft.continuous).toBe(false);
  });

  it('builds a settings patch with normalized LLM values', () => {
    const patch = draftToPatch({
      llm: {
        baseUrl: '  https://api.example.com/v1/  ',
        apiKey: '  sk-test  ',
        model: '  gpt-4o-mini  ',
      },
      blur: { en: true, zh: false },
      continuous: true,
    });

    expect(patch).toEqual({
      llm: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      },
      blur: { en: true, zh: false },
      playback: { continuous: true },
    });
  });

  it('normalizes the default-like form values', () => {
    expect(normalizeLlmForm(DEFAULT_SETTINGS.llm)).toEqual(DEFAULT_SETTINGS.llm);
  });

  it('accepts the default form values', () => {
    expect(validateLlmForm(DEFAULT_SETTINGS.llm)).toEqual({});
  });

  it('rejects blank or malformed endpoints and blank models', () => {
    expect(validateLlmForm({ baseUrl: '  ', apiKey: '', model: '' })).toMatchObject({
      baseUrl: expect.any(String),
      model: expect.any(String),
    });

    expect(
      validateLlmForm({ ...DEFAULT_SETTINGS.llm, baseUrl: 'not a url' }).baseUrl,
    ).toBeTruthy();
    expect(
      validateLlmForm({ ...DEFAULT_SETTINGS.llm, baseUrl: 'ftp://example.com/v1' }).baseUrl,
    ).toBeTruthy();
    expect(
      validateLlmForm({ ...DEFAULT_SETTINGS.llm, baseUrl: 'https://user:pass@example.com/v1' })
        .baseUrl,
    ).toBeTruthy();
  });

  it('truncates connection samples with an ellipsis', () => {
    expect(truncateSample('你好')).toBe('你好');
    expect(truncateSample('   ')).toBeUndefined();
    expect(truncateSample(undefined)).toBeUndefined();
    expect(truncateSample('x'.repeat(300), 20)).toBe(`${'x'.repeat(20)}…`);
  });
});

describe('origin permission helpers', () => {
  it('derives the origin pattern and drops the path, query and hash', () => {
    expect(deriveOriginPattern('http://127.0.0.1:3425/v1')).toBe('http://127.0.0.1:3425/*');
    expect(deriveOriginPattern('https://api.example.com/v1/chat?x=1#top')).toBe(
      'https://api.example.com/*',
    );
    expect(deriveOriginPattern('not a url')).toBeNull();
    expect(deriveOriginPattern('ftp://example.com')).toBeNull();
    expect(deriveOriginPattern('https://user:pass@example.com')).toBeNull();
  });

  it('does not ask for install-time localhost permissions', async () => {
    const contains = mockContains(false);
    const request = mockRequest(false);

    await expect(ensureBaseUrlPermission('http://127.0.0.1:3425/v1')).resolves.toEqual({
      granted: true,
      pattern: 'http://127.0.0.1:3425/*',
      requested: false,
    });
    await expect(ensureBaseUrlPermission('http://localhost:8080/v1')).resolves.toMatchObject({
      granted: true,
      requested: false,
    });

    expect(contains).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('skips the request when the origin is already granted', async () => {
    const contains = mockContains(true);
    const request = mockRequest(false);

    await expect(ensureBaseUrlPermission('https://api.example.com/v1')).resolves.toEqual({
      granted: true,
      pattern: 'https://api.example.com/*',
      requested: false,
    });

    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
    expect(request).not.toHaveBeenCalled();
  });

  it('requests a missing custom origin inside the save gesture', async () => {
    const contains = mockContains(false);
    const request = mockRequest(true);

    await expect(ensureBaseUrlPermission('https://api.example.com/v1')).resolves.toEqual({
      granted: true,
      pattern: 'https://api.example.com/*',
      requested: true,
    });

    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
    expect(request).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
  });

  it('refuses to continue when the user denies permission', async () => {
    mockContains(false);
    mockRequest(false);

    const result = await ensureBaseUrlPermission('https://api.example.com/v1');

    expect(result.granted).toBe(false);
    expect(result.pattern).toBe('https://api.example.com/*');
    expect(result.granted ? '' : result.error).toContain('权限');
  });

  it('rejects invalid endpoints before touching permissions', async () => {
    const contains = mockContains(false);
    const request = mockRequest(true);

    const result = await ensureBaseUrlPermission('ftp://example.com');

    expect(result.granted).toBe(false);
    expect(contains).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('turns permission API failures into a denial', async () => {
    mockContains(false);
    vi.spyOn(chromeMock.permissions, 'request').mockRejectedValue(new Error('browser refused'));

    const result = await ensureBaseUrlPermission('https://api.example.com/v1');

    expect(result.granted).toBe(false);
    expect(result.granted ? '' : result.error).toContain('browser refused');
  });
});
