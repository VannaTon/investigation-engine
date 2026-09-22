import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import {
  configuredInvestigationDataSource,
  configuredInvestigationNarrativeDataSource,
  usesFixtureData,
  configuredAlertListDataSource,
  configuredAlertLifecycleDataSource,
  liveInvestigationDataSource,
} from "./data/configuredInvestigationDataSource";
import {
  defaultAlertId,
  fixtureOptions,
  investigationPath,
} from "./data/investigationDataSource";
import { InvestigationPage } from "./pages/InvestigationPage";
import { InvestigationsPage } from "./pages/InvestigationsPage";
import { AlertRulesPage } from "./pages/AlertRulesPage";
import { ApplicationsPage } from "./pages/ApplicationsPage";
import { HttpAlertRuleDataSource } from "./data/alertRuleDataSource";
import { HttpMetricSampleDataSource } from "./data/metricSampleDataSource";
import { HttpMetricDiscoveryDataSource } from "./data/metricDiscoveryDataSource";
import { HttpApplicationDataSource } from "./data/applicationDataSource";
import { runtimeConfig } from "./config/runtimeConfig";
import {
  alertListHref,
  alertListViewFromSearch,
  type AlertListView,
} from "./lib/alertList";

export function isInvestigationListPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/investigations" || pathname === "/investigations/";
}

export function isAlertRulesPath(pathname: string): boolean {
  return pathname === "/alert-rules" || pathname === "/alert-rules/";
}
export function isApplicationsPath(pathname: string): boolean {
  return pathname === "/applications" || pathname === "/applications/";
}


// Rule management always uses the live API, even when investigation fixtures are selected.
const configuredAlertRuleDataSource = new HttpAlertRuleDataSource(runtimeConfig.apiBaseUrl);
const configuredMetricSampleDataSource = new HttpMetricSampleDataSource(runtimeConfig.apiBaseUrl);
const configuredMetricDiscoveryDataSource = new HttpMetricDiscoveryDataSource(runtimeConfig.apiBaseUrl);
const configuredApplicationDataSource = new HttpApplicationDataSource(runtimeConfig.apiBaseUrl);

export function alertIdFromPath(pathname: string): string | null {
  if (pathname === "/") return defaultAlertId;

  const match = pathname.match(/^\/investigations\/([^/]+)\/?$/);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [locationSearch, setLocationSearch] = useState(window.location.search);
  const [liveDetail, setLiveDetail] = useState(() => new URLSearchParams(window.location.search).get("source") === "live");
  const [alertId, setAlertId] = useState<string | null>(() =>
    alertIdFromPath(window.location.pathname),
  );

  useEffect(() => {
    if (window.location.pathname === "/") {
      const nextHref = alertListHref(
        alertListViewFromSearch(window.location.search),
      );
      window.history.replaceState(null, "", nextHref);
      setPathname("/investigations");
      setLocationSearch(window.location.search);
    }

    const handlePopState = () => {
      setPathname(window.location.pathname);
      setLocationSearch(window.location.search);
      setLiveDetail(new URLSearchParams(window.location.search).get("source") === "live");
      setAlertId(alertIdFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigateToInvestigation(nextAlertId: string) {
    const nextPath = investigationPath(nextAlertId);

    if (window.location.pathname !== nextPath || window.location.search) {
      window.history.pushState(null, "", nextPath);
    }

    setAlertId(nextAlertId);
    setPathname(nextPath);
    setLocationSearch("");
    setLiveDetail(false);
  }

  function updateWorkspaceView(view: AlertListView) {
    const nextHref = alertListHref(view);
    window.history.replaceState(null, "", nextHref);
    const separator = nextHref.indexOf("?");
    setLocationSearch(separator === -1 ? "" : nextHref.slice(separator));
  }

  const listPage = isInvestigationListPath(pathname);
  const rulePage = isAlertRulesPath(pathname);
  const applicationPage = isApplicationsPath(pathname);
  const workspaceView = alertListViewFromSearch(locationSearch);
  const workspaceHref = alertListHref(workspaceView);
  return (
    <AppShell
      activeProduct={applicationPage ? "applications" : rulePage ? "alert-rules" : "investigations"}
      investigationHref={workspaceHref}
      currentAlertId={listPage || rulePage || applicationPage ? null : alertId}
      showInvestigationNavigation={!listPage && !rulePage && !applicationPage && alertId !== null}
      pageTitle={applicationPage ? "Applications" : rulePage ? "Alert rules" : listPage ? "Investigations" : "Investigation detail"}
      fixtureOptions={usesFixtureData && !listPage && !rulePage && !applicationPage ? fixtureOptions : []}
      onSelectFixture={navigateToInvestigation}
    >
      {applicationPage ? <ApplicationsPage dataSource={configuredApplicationDataSource} apiBaseUrl={runtimeConfig.apiBaseUrl} />
        : rulePage ? <AlertRulesPage dataSource={configuredAlertRuleDataSource} applicationDataSource={configuredApplicationDataSource}
          sampleDataSource={configuredMetricSampleDataSource} discoveryDataSource={configuredMetricDiscoveryDataSource} /> : listPage ? <InvestigationsPage
        dataSource={configuredAlertListDataSource}
        initialView={workspaceView}
        onViewChange={updateWorkspaceView}
      /> : <InvestigationPage
        key={`${alertId}-${liveDetail ? "live" : usesFixtureData ? "fixture" : "api"}`}
        alertId={alertId}
        returnHref={workspaceHref}
        dataSource={liveDetail ? liveInvestigationDataSource : configuredInvestigationDataSource}
        narrativeDataSource={configuredInvestigationNarrativeDataSource}
        lifecycleDataSource={liveDetail || !usesFixtureData ? configuredAlertLifecycleDataSource : undefined}
        onOpenDefault={
          usesFixtureData
            ? () => navigateToInvestigation(defaultAlertId)
            : undefined
        }
      />}
    </AppShell>
  );
}

export default App;
