import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's class merge helper: `clsx` for conditionals, `tailwind-merge` so a
 * caller's utility class beats the component's own default instead of the two
 * both landing in the class list and the cascade deciding at random.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
