import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { hashTargetId } from "../lib/investigationReviewLocation";

interface CollapsibleInvestigationSectionProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  count?: number;
  Icon: LucideIcon;
  defaultExpanded?: boolean;
  flush?: boolean;
  children: ReactNode;
}

export function CollapsibleInvestigationSection({
  id,
  eyebrow,
  title,
  description,
  count,
  Icon,
  defaultExpanded = false,
  flush = false,
  children,
}: CollapsibleInvestigationSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headingId = `${id}-heading`;
  const contentId = `${id}-content`;

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const expandForCurrentHash = () => {
      const targetId = hashTargetId(window.location.hash);
      if (!targetId) return;
      const content = document.getElementById(contentId);
      const target = document.getElementById(targetId);

      if (
        targetId === id ||
        (content && target && content.contains(target))
      ) {
        setExpanded(true);
      }
    };

    expandForCurrentHash();
    window.addEventListener("hashchange", expandForCurrentHash);
    return () => window.removeEventListener("hashchange", expandForCurrentHash);
  }, [contentId, id]);

  return (
    <section
      id={id}
      tabIndex={-1}
      className={
        (flush ? "" : "mt-6 ") +
        "scroll-mt-20 overflow-hidden rounded-xl border border-steel bg-surface shadow-panel outline-none"
      }
      aria-labelledby={headingId}
    >
      <button
        type="button"
        className="flex w-full flex-wrap items-start justify-between gap-4 px-5 py-4 text-left hover:bg-canvas/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink sm:px-6"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-slate">
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {eyebrow}
          </span>
          <span
            id={headingId}
            className="mt-1 block text-base font-extrabold tracking-tight text-ink"
          >
            {title}
          </span>
          <span className="mt-1 block max-w-3xl text-xs leading-5 text-slate">
            {description}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {count !== undefined && (
            <span className="rounded-md bg-canvas px-2 py-1 font-mono text-xs font-bold text-slate">
              {count}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink">
            {expanded ? "Collapse" : "Expand"}
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </span>
        </span>
      </button>

      <div id={contentId} hidden={!expanded} className="border-t border-steel">
        {children}
      </div>
    </section>
  );
}



