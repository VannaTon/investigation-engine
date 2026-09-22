import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppSidebar, investigationSectionIds } from "./AppSidebar";
import { TopBar } from "./TopBar";
import type { FixtureSelectorOption } from "./FixtureSelector";
import { hashTargetId } from "../lib/investigationReviewLocation";

interface AppShellProps {
  activeProduct?: "investigations" | "alert-rules" | "applications";
  showInvestigationNavigation?: boolean;
  pageTitle?: string;
  children: ReactNode;
  investigationHref: string;
  currentAlertId: string | null;
  fixtureOptions?: readonly FixtureSelectorOption[];
  onSelectFixture: (alertId: string) => void;
}

export function investigationSectionIdFromHash(hash: string): string | null {
  const targetId = hashTargetId(hash);
  if (!targetId) return null;
  if (investigationSectionIds.includes(targetId)) return targetId;
  if (targetId.startsWith("finding-")) return "findings";
  if (targetId.startsWith("investigation-log-")) return "telemetry";
  return null;
}

export function AppShell({
  activeProduct = "investigations",
  children,
  investigationHref,
  currentAlertId,
  fixtureOptions = [],
  showInvestigationNavigation = true,
  pageTitle = "Investigation detail",
  onSelectFixture,
}: AppShellProps) {
  const mobileNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState("overview");

  useEffect(() => {
    const hashSection =
      typeof window === "undefined"
        ? null
        : investigationSectionIdFromHash(window.location.hash);
    setActiveSectionId(hashSection ?? "overview");
    setMobileNavigationOpen(false);
  }, [currentAlertId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateActiveSection = () => {
      const sectionId = investigationSectionIdFromHash(window.location.hash);
      if (sectionId) setActiveSectionId(sectionId);
    };

    updateActiveSection();
    window.addEventListener("hashchange", updateActiveSection);
    return () => window.removeEventListener("hashchange", updateActiveSection);
  }, []);

  useEffect(() => {
    if (
      !mobileNavigationOpen ||
      typeof document === "undefined" ||
      !document.body
    ) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      mobileNavigationButtonRef.current?.focus();
    };
  }, [mobileNavigationOpen]);
  const productLabel = activeProduct === "alert-rules" ? "Alert Rules"
    : activeProduct === "applications" ? "Applications" : "Investigations";
  const skipLabel = activeProduct === "alert-rules" ? "Skip to alert rules"
    : activeProduct === "applications" ? "Skip to applications" : "Skip to investigation";

  return (
    <div className="flex min-h-screen overflow-x-clip bg-canvas text-ink">
      <a
        href="#investigation-content"
        className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-md bg-ink px-3 py-2 text-sm font-bold text-white focus:translate-y-0 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white"
      >
        {skipLabel}
      </a>

      {mobileNavigationOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-ink/25 lg:hidden"
          onClick={() => setMobileNavigationOpen(false)}
          aria-label="Close navigation overlay"
          tabIndex={-1}
        />
      )}

      <AppSidebar
        activeProduct={activeProduct}
        showInvestigationNavigation={showInvestigationNavigation}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavigationOpen}
        investigationHref={investigationHref}
        activeSectionId={activeSectionId}
        onNavigateSection={setActiveSectionId}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onCloseMobile={() => setMobileNavigationOpen(false)}
      />

      <div
        className="min-w-0 flex-1"
        inert={mobileNavigationOpen ? true : undefined}
      >
        <TopBar
          productLabel={productLabel}
          pageTitle={pageTitle}
          fixtureOptions={fixtureOptions}
          selectedAlertId={currentAlertId}
          mobileNavigationOpen={mobileNavigationOpen}
          mobileNavigationButtonRef={mobileNavigationButtonRef}
          onOpenMobileNavigation={() => setMobileNavigationOpen(true)}
          onSelectFixture={onSelectFixture}
        />

        <main
          id="investigation-content"
          className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

