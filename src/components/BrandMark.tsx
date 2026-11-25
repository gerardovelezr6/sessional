// The school's mark beside its name: its logo, or a square in the brand colour with its initials.
export function BrandMark({ logo, initials, size = 34 }: { logo: string | null; initials: string | null; size?: number }) {
  if (logo) {
    // The name is written beside it, so the image needs no text of its own.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt="" width={size * 3} height={size} className="block w-auto object-contain" style={{ height: size, maxWidth: size * 3 }} />;
  }
  if (!initials) return null;
  return (
    <span aria-hidden="true" className="brand-mark" style={{ height: size, width: size, fontSize: Math.max(10, Math.round(size / 3)) }}>
      {initials}
    </span>
  );
}
