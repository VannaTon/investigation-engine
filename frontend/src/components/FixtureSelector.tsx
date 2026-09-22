import { useRef } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";

export interface FixtureSelectorOption {
  alertId: string;
  label: string;
}

interface FixtureSelectorProps {
  options: readonly FixtureSelectorOption[];
  selectedAlertId: string | null;
  onSelect: (alertId: string) => void;
}

const fixtureGroups = [
  { label: "Alert status", options: ["Resolved", "Firing"] },
  { label: "Evidence examples", options: ["Empty", "Deep trace", "Groups"] },
  { label: "Data checks", options: ["Mismatch", "Missing refs"] },
  { label: "Ranking ties", options: ["Candidate tie"] },
];

const exampleLabels: Record<string, string> = {
  Empty: "No evidence",
  "Deep trace": "Long request path",
  Groups: "Grouped evidence",
  Mismatch: "Service mismatch",
  "Missing refs": "Missing links",
  "Candidate tie": "Tied candidates",
};

export function FixtureSelector({
  options,
  selectedAlertId,
  onSelect,
}: FixtureSelectorProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected =
    options.find((option) => option.alertId === selectedAlertId) ?? options[0];

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-steel bg-canvas px-3 py-2 text-xs font-extrabold text-ink hover:border-slate/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden"
        aria-label="Open example investigations"
      >
        <FlaskConical className="h-3.5 w-3.5 text-slate" aria-hidden="true" />
        <span className="hidden sm:inline">Examples</span>
        {selected && (
          <span className="max-w-24 truncate font-mono text-xs text-slate">
            {exampleLabels[selected.label] ?? selected.label}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-slate" aria-hidden="true" />
      </summary>

      <div
        className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-steel bg-surface shadow-panel"
        aria-label="Example investigations"
      >
        <div className="border-b border-steel px-4 py-3">
          <p className="text-xs font-extrabold text-ink">Example investigations</p>
          <p className="mt-1 text-xs leading-5 text-slate">
            Sample data for exploring the interface. These are not live alerts.
          </p>
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto p-2">
          {fixtureGroups.map((group) => {
            const groupOptions = group.options
              .map((label) => options.find((option) => option.label === label))
              .filter((option): option is FixtureSelectorOption => Boolean(option));

            if (groupOptions.length === 0) return null;

            return (
              <div key={group.label} className="mb-2 last:mb-0">
                <p className="px-2 py-1 text-xs font-extrabold uppercase tracking-[0.14em] text-slate">
                  {group.label}
                </p>
                {groupOptions.map((option) => {
                  const active = option.alertId === selectedAlertId;

                  return (
                    <button
                      key={option.alertId}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        onSelect(option.alertId);
                        detailsRef.current?.removeAttribute("open");
                      }}
                      className={
                        "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink " +
                        (active
                          ? "bg-canvas text-ink"
                          : "text-slate hover:bg-canvas hover:text-ink")
                      }
                    >
                      <span>{exampleLabels[option.label] ?? option.label}</span>
                      {active && (
                        <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate">
                          Current
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
