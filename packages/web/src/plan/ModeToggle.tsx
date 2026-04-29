export type PlanMode = "single" | "compare";

export function ModeToggle({
  value,
  onChange,
}: {
  value: PlanMode;
  onChange: (m: PlanMode) => void;
}) {
  return (
    <div
      className="flex p-1 rounded-xl text-xs font-semibold"
      style={{ background: "var(--ow-bg-2)", border: "1px solid var(--ow-line-2)" }}
      role="tablist"
      aria-label="Mode de planification"
    >
      {(
        [
          ["single", "Simuler ma route"],
          ["compare", "Comparer les fenêtres"],
        ] as const
      ).map(([m, label]) => {
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m)}
            className="flex-1 px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: active ? "var(--ow-bg-1)" : "transparent",
              color: active ? "var(--ow-fg-0)" : "var(--ow-fg-2)",
              boxShadow: active ? "var(--ow-shadow-soft)" : "none",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
