import 'flag-icons/css/flag-icons.min.css';
import type { FlagChoice } from '@/structure/flags';

// A small flag beside a delegate: a country (flag-icons), a US state (bundled in public/flags/us)
// or a group's uploaded logo. Decorative: the delegate's name is always written next to it.
export function Flag({ choice, logoUrl, className = '' }: { choice: FlagChoice; logoUrl?: string | null; className?: string }) {
  const box = `inline-block h-4 w-6 shrink-0 overflow-hidden rounded-sm border border-border ${className}`;
  if (!choice) return <span className={`${box} border-dashed`} aria-hidden="true" />;
  if (choice.kind === 'country' && /^[a-z]{2}$/.test(choice.code)) return <span className={`fi fi-${choice.code} ${box} bg-cover`} aria-hidden="true" />;
  if (choice.kind === 'us' && /^[a-z]{2}$/.test(choice.code)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/flags/us/${choice.code}.svg`} alt="" className={`${box} object-cover`} loading="lazy" />;
  }
  if (choice.kind === 'logo' && logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" className={`${box} bg-surface-raised object-contain`} loading="lazy" />;
  }
  return <span className={`${box} border-dashed`} aria-hidden="true" />;
}
