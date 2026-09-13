import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, X, type LucideIcon } from "lucide-react";

interface InvestigationDetailDrawerProps {
  id: string;
  open: boolean;
  eyebrow: string;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function InvestigationDetailDrawer({
  id,
  open,
  eyebrow,
  title,
  description,
  onClose,
  children,
}: InvestigationDetailDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const headingId = `${id}-heading`;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className="fixed inset-0 z-[70]" data-investigation-drawer={id}>
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-ink/30"
        aria-label={`Close ${title} details`}
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-steel bg-surface shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-4 border-b border-steel bg-surface px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.17em] text-slate">
              {eyebrow}
            </p>
            <h2
              id={headingId}
              className="mt-1 break-words text-lg font-extrabold tracking-tight text-ink [overflow-wrap:anywhere]"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 max-w-xl text-xs leading-5 text-slate"
              >
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-steel text-slate hover:bg-canvas hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            aria-label={`Close ${title} details`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}

interface InvestigationDetailSectionProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  count?: number;
  Icon: LucideIcon;
  actionLabel?: string;
  drawerTitle?: string;
  drawerDescription?: string;
  warning?: boolean;
  grouped?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  preview?: ReactNode;
  children: ReactNode;
}

export function InvestigationDetailSection({
  id,
  eyebrow,
  title,
  description,
  count,
  Icon,
  actionLabel = "View",
  drawerTitle = title,
  drawerDescription = description,
  warning = false,
  grouped = false,
  open: controlledOpen,
  onOpenChange,
  preview,
  children,
}: InvestigationDetailSectionProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const drawerId = `${id}-drawer`;

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <section
      id={id}
      tabIndex={-1}
      className={
        grouped
          ? "scroll-mt-20 border-t border-steel bg-surface outline-none first:border-t-0"
          : `mt-6 scroll-mt-20 overflow-hidden rounded-xl border bg-surface shadow-panel outline-none ${
              warning ? "border-incident/35" : "border-steel"
            }`
      }
      aria-labelledby={`${id}-summary-heading`}
    >
      <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
              warning
                ? "border-incident/30 bg-incident/[0.06] text-incident"
                : "border-steel bg-canvas text-slate"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.15em] text-slate">
                {eyebrow}
              </p>
              {count !== undefined && (
                <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.68rem] font-extrabold text-slate">
                  {count}
                </span>
              )}
            </div>
            <h2
              id={`${id}-summary-heading`}
              className="mt-0.5 text-sm font-extrabold text-ink"
            >
              {title}
            </h2>
            <p className="mt-0.5 break-words text-xs leading-5 text-slate [overflow-wrap:anywhere]">
              {description}
            </p>
            {preview && <div className="mt-2">{preview}</div>}
          </div>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 justify-self-start rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:justify-self-end"
        >
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <InvestigationDetailDrawer
        id={drawerId}
        open={open}
        eyebrow={eyebrow}
        title={drawerTitle}
        description={drawerDescription}
        onClose={() => setOpen(false)}
      >
        {children}
      </InvestigationDetailDrawer>
    </section>
  );
}
