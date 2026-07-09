import { cn } from '@palouse/ui';

/**
 * The horizon line: a low rolling-hills curve used as the footer of stat cards
 * and the backdrop of empty states, at 8-13% opacity (docs/design-system.md
 * section 3.5). It appears in exactly those two places and is never a loud hero.
 *
 * Renders as an absolutely-positioned SVG pinned to the bottom of a `relative`,
 * `overflow-hidden` parent. It stretches to full width (preserveAspectRatio
 * "none") and inherits currentColor, so it themes with the surface it sits on.
 */
export function Horizon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 64"
      preserveAspectRatio="none"
      fill="none"
      className={cn(
        'text-primary pointer-events-none absolute inset-x-0 bottom-0 h-14 w-full',
        className,
      )}
    >
      <path
        d="M0 34 C 60 16, 130 30, 200 26 S 340 14, 400 28 L400 64 L0 64 Z"
        fill="currentColor"
        opacity={0.1}
      />
      <path
        d="M0 46 C 80 32, 150 44, 224 40 S 356 30, 400 42 L400 64 L0 64 Z"
        fill="currentColor"
        opacity={0.08}
      />
    </svg>
  );
}
