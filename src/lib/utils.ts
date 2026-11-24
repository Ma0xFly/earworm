import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui class merge helper.
 *
 * NOTE: the npm package named `cn` is NOT this helper; we intentionally use
 * `clsx` + `tailwind-merge`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
