export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
      <rect width="128" height="128" rx="28" fill="#2563eb" />
      <path
        d="M30 38h40M50 30v8M36 38c3 13 12 23 26 30M64 38c-4 15-14 27-30 34"
        stroke="#fff"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M68 98l15-34 15 34M73 87h20"
        stroke="#bfdbfe"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
