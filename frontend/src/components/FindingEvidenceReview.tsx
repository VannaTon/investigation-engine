import {
  FileSearch,
  Layers3,
  Link2,
  Network,
  ScrollText,
  Waypoints,
} from "lucide-react";
import { correlationTypeLabels } from "../lib/evidenceGroups";
import type { FindingEvidenceReview as FindingEvidenceReviewModel } from "../lib/findingEvidenceReview";
import { formatTime } from "../lib/formatters";
import { logDomId } from "../lib/investigationTargets";
import type { ExactSpanReference } from "../lib/exactSpanLogs";
import { SupportTypeBreakdown, SupportTypeCount } from "./SupportTypes";
import { ExactIdentifiers } from "./ExactIdentifiers";
import { signalTypeLabels } from "./StructuralSignals";

interface FindingEvidenceReviewProps {
  id: string;
  review: FindingEvidenceReviewModel;
  onOpenExactSpanLogs?: (reference: ExactSpanReference) => void;
}

function ReviewSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileSearch;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-steel bg-surface p-3.5">
      <h4 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </h4>
      {children}
    </section>
  );
}

export function FindingEvidenceReview({
  id,
  review,
  onOpenExactSpanLogs,
}: FindingEvidenceReviewProps) {
  const hasExplicitContext = Boolean(
    review.rank ||
      review.evidenceGroups.length ||
      review.correlations.length ||
      review.signals.length ||
      review.exactSpanReference,
  );
  const firstExactLog = review.exactSpanLogs[0];

  return (
    <section
      id={id}
      aria-label={"Evidence review for " + review.finding.message}
      className="mt-4 rounded-lg border border-ink bg-canvas p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate">
            Focused evidence review
          </p>
          <h3 className="mt-1 text-sm font-extrabold text-ink">
            Linked evidence
          </h3>
        </div>
        {review.priority !== undefined && (
          <span className="rounded-md bg-ink px-2 py-1 font-mono text-xs font-extrabold text-white">
            {"Finding priority #" + review.priority}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate">
        Links use recorded IDs; matching a step requires both trace and span IDs.
        Use these links to review the exact recorded evidence.
      </p>

      {!hasExplicitContext ? (
        <p className="mt-3 rounded-md border border-dashed border-steel bg-surface px-3 py-3 text-xs leading-5 text-slate">
          No linked evidence is available for this finding.
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          {review.rank && (
            <ReviewSection icon={FileSearch} title="Finding priority reasons">
              <p className="mt-2 font-mono text-xs font-bold text-ink">
                <SupportTypeCount count={review.rank.supportScore} />
              </p>
              <SupportTypeBreakdown
                correlationTypes={review.rank.correlationTypes}
                signalTypes={review.rank.signalTypes}
              />
              {review.rank.reasons.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {review.rank.reasons.map((reason) => (
                    <li
                      key={reason}
                      className="flex gap-2 text-xs leading-5 text-ink"
                    >
                      <span aria-hidden="true">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate">
                  No ranking reasons are available.
                </p>
              )}
            </ReviewSection>
          )}

          {review.evidenceGroups.length > 0 && (
            <ReviewSection icon={Layers3} title="Grouped evidence">
              <ul className="mt-2 space-y-2">
                {review.evidenceGroups.map((group) => (
                  <li key={group.id} className="rounded-md bg-canvas px-3 py-2.5">
                    <p className="text-xs font-semibold leading-5 text-ink">
                      {group.message}
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate">
                      {group.findingCount} findings · {group.services.join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
            </ReviewSection>
          )}

          {review.correlations.length > 0 && (
            <ReviewSection icon={Link2} title="Connections">
              <ul className="mt-2 space-y-2">
                {review.correlations.map((correlation) => (
                  <li
                    key={correlation.id}
                    className="rounded-md bg-canvas px-3 py-2.5"
                  >
                    <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate">
                      {correlationTypeLabels[correlation.type]}
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-ink">
                      {correlation.message}
                    </p>
                  </li>
                ))}
              </ul>
            </ReviewSection>
          )}

          {review.signals.length > 0 && (
            <ReviewSection icon={Network} title="Evidence patterns">
              <ul className="mt-2 space-y-2">
                {review.signals.map((signal) => (
                  <li key={signal.id} className="rounded-md bg-canvas px-3 py-2.5">
                    <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate">
                      {signalTypeLabels[signal.type]}
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-ink">
                      {signal.message}
                    </p>
                  </li>
                ))}
              </ul>
            </ReviewSection>
          )}

          {review.exactSpanReference && (
            <ReviewSection icon={Waypoints} title="Matching request step">
              <ExactIdentifiers
                className="mt-2"
                summary="Trace and span IDs"
                identifiers={[
                  { label: "Trace ID", value: review.exactSpanReference.traceId },
                  { label: "Span ID", value: review.exactSpanReference.spanId },
                ]}
              />
              {review.exactSpan ? (
                <dl className="mt-2 grid gap-2 rounded-md bg-canvas px-3 py-2.5 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="font-bold text-slate">Service</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-ink">
                      {review.exactSpan.service}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate">Operation</dt>
                    <dd className="mt-0.5 break-words font-mono font-semibold text-ink">
                      {review.exactSpan.operation}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate">Status</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-ink">
                      {review.exactSpan.status}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate">Duration</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-ink">
                      {review.exactSpan.durationMs} ms
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate">
                  The linked step (span) is not available in this investigation
                  evidence.
                </p>
              )}

              {review.exactSpanLogs.length > 0 ? (
                <>
                  <p className="mt-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.1em] text-slate">
                    <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                    {review.exactSpanLogs.length}{" "}
                    {review.exactSpanLogs.length === 1 ? "log" : "logs"}
                    {" for this step"}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {review.exactSpanLogs.map(({ index, log }) => (
                      <li key={String(index) + log.timestamp} className="rounded-md bg-canvas px-3 py-2.5">
                        <p className="text-xs font-semibold leading-5 text-ink">
                          {log.message}
                        </p>
                        <p className="mt-1 font-mono text-xs text-slate">
                          {log.service} · {formatTime(log.timestamp)}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {onOpenExactSpanLogs && firstExactLog && (
                    <a
                      href={
                        "#" +
                        logDomId(
                          firstExactLog.log.timestamp,
                          firstExactLog.log.service,
                          firstExactLog.index,
                        )
                      }
                      onClick={() =>
                        onOpenExactSpanLogs(review.exactSpanReference!)
                      }
                      className="mt-3 inline-flex items-center gap-2 rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      Open logs for this step
                    </a>
                  )}
                </>
              ) : (
                <p className="mt-3 text-xs leading-5 text-slate">
                  No logs share both the recorded trace and span IDs in this investigation.
                </p>
              )}
            </ReviewSection>
          )}
        </div>
      )}
    </section>
  );
}
