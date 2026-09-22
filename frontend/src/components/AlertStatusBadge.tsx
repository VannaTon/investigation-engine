import { CheckCircle2, CircleAlert, Eye } from "lucide-react";
import type { AlertStatus } from "../types/investigation";

interface AlertStatusBadgeProps {
  status: AlertStatus;
}

const alertStatusPresentations: Record<
  AlertStatus,
  {
    label: string;
    className: string;
    Icon: typeof CircleAlert;
  }
> = {
  firing: {
    label: "Firing",
    className: "border-incident/30 bg-incident/[0.07] text-incident",
    Icon: CircleAlert,
  },
  acknowledged: {
    label: "Acknowledged",
    className: "border-ink/30 bg-canvas text-ink",
    Icon: Eye,
  },
  resolved: {
    label: "Resolved",
    className: "border-steel bg-canvas text-slate",
    Icon: CheckCircle2,
  },
};

export function AlertStatusBadge({ status }: AlertStatusBadgeProps) {
  const { label, className, Icon } = alertStatusPresentations[status];

  return (
    <span
      data-alert-status={status}
      className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold " + className}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
