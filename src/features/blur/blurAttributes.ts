/**
 * Blur attribute mapping for the body-level app root.
 *
 * The blur stylesheet targets `data-blur-en` / `data-blur-zh` with the string
 * values `"1"` / `"0"`; the two independent switches are encoded in one place.
 */

import type { Settings } from '@/lib/contracts';

export type BlurDataAttributes = {
  'data-blur-en': '0' | '1';
  'data-blur-zh': '0' | '1';
};

/** Encode the two blur switches as the attributes the shadow stylesheet reads. */
export function blurDataAttributes(blur: Settings['blur']): BlurDataAttributes {
  return {
    'data-blur-en': blur.en ? '1' : '0',
    'data-blur-zh': blur.zh ? '1' : '0',
  };
}
