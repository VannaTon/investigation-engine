import type { AlertStatus, InvestigationAlert } from "../types/investigation";
import { parseTimestamp } from "./formatters";

export type AlertStatusFilter = "all" | AlertStatus;

export interface AlertListView {
  query: string;
  status: AlertStatusFilter;
}

export const defaultAlertListView: AlertListView = {
  query: "",
  status: "all",
};

const alertStatusFilters: readonly AlertStatusFilter[] = [
  "all",
  "firing",
  "acknowledged",
  "resolved",
];

export function alertListViewFromSearch(search: string): AlertListView {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const status = params.get("status") ?? "all";

  return {
    query: params.get("q") ?? "",
    status: alertStatusFilters.includes(status as AlertStatusFilter)
      ? (status as AlertStatusFilter)
      : "all",
  };
}

function appendAlertListView(
  params: URLSearchParams,
  view: AlertListView,
): void {
  if (view.query.length > 0) params.set("q", view.query);
  if (view.status !== "all") params.set("status", view.status);
}

export function alertListHref(view: AlertListView): string {
  const params = new URLSearchParams();
  appendAlertListView(params, view);
  const search = params.toString();
  return search ? `/investigations?${search}` : "/investigations";
}

export function liveInvestigationHref(
  alertId: string,
  view: AlertListView,
): string {
  const params = new URLSearchParams({ source: "live" });
  appendAlertListView(params, view);
  return `/investigations/${encodeURIComponent(alertId)}?${params.toString()}`;
}

export function selectAlerts(alerts: readonly InvestigationAlert[], query: string, status: AlertStatusFilter): InvestigationAlert[] {
  const search = query.trim().toLowerCase();
  return alerts.filter((alert) =>
    (status === "all" || alert.status === status) &&
    [alert.title, alert.service ?? "", alert.message].some((value) => value.toLowerCase().includes(search)),
  ).sort((a, b) => parseTimestamp(b.updatedAt).getTime() - parseTimestamp(a.updatedAt).getTime() || a.id.localeCompare(b.id));
}
