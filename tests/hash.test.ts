import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/hash';

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector for "abc"', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes UTF-8, not UTF-16', async () => {
    // "你好" UTF-8 is 6 bytes; a UTF-16-based implementation would differ.
    await expect(sha256Hex('你好')).resolves.toBe(
      '670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e',
    );
  });

  it('differs for different cue text', async () => {
    const a = await sha256Hex('hello world');
    const b = await sha256Hex('hello worlds');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
