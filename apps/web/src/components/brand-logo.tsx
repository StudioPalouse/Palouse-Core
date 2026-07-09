import { cn } from '@palouse/ui';

/**
 * The rolling-hills brand mark, drawn as inline SVG so it inherits currentColor,
 * scales crisply, and themes without a per-theme asset swap. Three receding hill
 * layers echo the Palouse's contoured fields. Defaults to the Forest primary;
 * pass a text-color class to recolor (for example on a colored surface).
 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label=""
      className={cn('text-primary', className)}
    >
      <path
        d="M0 11 C 4 7.5, 8 9, 12 8.2 S 20 5.5, 24 8 L24 24 L0 24 Z"
        fill="currentColor"
        opacity={0.3}
      />
      <path
        d="M0 15 C 5 11.5, 9 13, 13 12.2 S 20 10, 24 12.5 L24 24 L0 24 Z"
        fill="currentColor"
        opacity={0.55}
      />
      <path
        d="M0 19.5 C 4 16.8, 9 17.6, 13 16.8 S 20 14.8, 24 17 L24 24 L0 24 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Mark + wordmark lockup for auth pages and other standalone surfaces. */
export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={36} />
      <span className="text-2xl font-semibold tracking-tight">Palouse</span>
    </div>
  );
}
