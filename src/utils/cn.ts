import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names, letting later classes win over earlier ones that
 * set the same property. Without this, a component's default `bg-primary` and a
 * caller's `bg-danger` both end up in the class string and which one applies
 * depends on NativeWind's ordering rather than on intent.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
