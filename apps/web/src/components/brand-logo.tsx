import Image from 'next/image';

/**
 * The circular rolling-hills brand mark. The green gradient with white contour
 * lines reads on both the light and the green-tinted dark theme, so no per-theme
 * swap is needed; pair it with text that inherits the foreground color.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return <Image src="/brand/mark.png" alt="" width={size} height={size} priority />;
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
