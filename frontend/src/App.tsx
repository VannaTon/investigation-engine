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
import {
  alertListHref,
  alertListViewFromSearch,
  type AlertListView,
} from "./lib/alertList";

export function isInvestigationListPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/investigations" || pathname === "/investigations/";
}

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
  const workspaceView = alertListViewFromSearch(locationSearch);
  const workspaceHref = alertListHref(workspaceView);
  return (
    <AppShell
      investigationHref={workspaceHref}
      currentAlertId={listPage ? null : alertId}
      showInvestigationNavigation={!listPage && alertId !== null}
      pageTitle={listPage ? "Investigation workspace" : "Investigation detail"}
      fixtureOptions={usesFixtureData && !listPage ? fixtureOptions : []}
      onSelectFixture={navigateToInvestigation}
    >
      {listPage ? <InvestigationsPage
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
