import { instrumentSerif } from "@/lib/fonts";

// Brand mark — SC for StudentCareer AI.
export function CoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-secondary text-white font-bold tracking-tight shadow-sm shadow-brand/20"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.48),
      }}
    >
      SC
    </span>
  );
}
