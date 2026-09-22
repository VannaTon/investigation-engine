import { ChevronRight } from "lucide-react";

interface ExactIdentifiersProps {
  identifiers: readonly { label: string; value: string }[];
  summary?: string;
  className?: string;
}

export function ExactIdentifiers({
  identifiers,
  summary = "Show IDs",
  className = "",
}: ExactIdentifiersProps) {
  if (identifiers.length === 0) return null;

  return (
    <details className={`group/identifiers min-w-0 max-w-full text-xs text-slate ${className}`}>
      <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open/identifiers:rotate-90" aria-hidden="true" />
        {summary}
      </summary>
      <dl className="mt-2 grid min-w-0 gap-2">
        {identifiers.map(({ label, value }, index) => (
          <div key={`${label}-${index}`} className="min-w-0">
            <dt className="font-semibold">{label}</dt>
            <dd className="mt-1 min-w-0">
              <code className="block select-text whitespace-pre-wrap break-all font-mono text-xs text-ink">{value}</code>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
