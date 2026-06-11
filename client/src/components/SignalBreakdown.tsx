import type { ConfidenceBreakdownItem } from "../types";

export function SignalBreakdown({ items }: { items: ConfidenceBreakdownItem[] }) {
  if (!items?.length) return null;

  return (
    <details className="mb-3 group">
      <summary className="text-sm text-slate-400 cursor-pointer hover:text-slate-200 transition-colors">
        Signal breakdown
      </summary>
      <ul className="mt-2 space-y-1.5 text-xs">
        {items.map((item) => (
          <li
            key={item.key}
            className="bg-surface-raised rounded px-2 py-1.5 text-slate-300 leading-relaxed"
          >
            {item.detail ?? item.label}
          </li>
        ))}
      </ul>
    </details>
  );
}
