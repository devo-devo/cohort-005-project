/**
 * PROTOTYPE: floating variant switcher for UI prototypes — throwaway tooling,
 * not product UI. Gated behind `?variant=` and hidden in production builds.
 */

import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

const VARIANTS = [
  { key: null, label: "Default layout" },
  { key: "a", label: "A — Bell in sidebar footer" },
  { key: "b", label: "B — Top bar, grouped dropdown" },
  { key: "c", label: "C — Sidebar nav item + page drawer" },
];

export function PrototypeSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();

  const currentKey = searchParams.get("variant");
  const currentIndex = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === currentKey)
  );

  function cycle(direction: 1 | -1) {
    const next = VARIANTS[(currentIndex + direction + VARIANTS.length) % VARIANTS.length];
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next.key === null) {
          params.delete("variant");
        } else {
          params.set("variant", next.key);
        }
        return params;
      },
      { replace: true }
    );
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (import.meta.env.PROD) return null;

  const current = VARIANTS[currentIndex];

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-zinc-900 px-2 py-1.5 text-zinc-100 shadow-xl">
      <button
        onClick={() => cycle(-1)}
        className="rounded-full p-1.5 transition-colors hover:bg-white/10"
        title="Previous variant (←)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-64 text-center text-xs font-medium tabular-nums">
        {current.key ? current.key.toUpperCase() : "—"} · {current.label}
      </span>
      <button
        onClick={() => cycle(1)}
        className="rounded-full p-1.5 transition-colors hover:bg-white/10"
        title="Next variant (→)"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
