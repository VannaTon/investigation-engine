import type { Ref } from "react";
import { Menu } from "lucide-react";
import {
  FixtureSelector,
  type FixtureSelectorOption,
} from "./FixtureSelector";

interface TopBarProps {
  pageTitle?: string;
  fixtureOptions: readonly FixtureSelectorOption[];
  selectedAlertId: string | null;
  mobileNavigationOpen?: boolean;
  mobileNavigationButtonRef?: Ref<HTMLButtonElement>;
  onOpenMobileNavigation: () => void;
  onSelectFixture: (alertId: string) => void;
}

export function TopBar({
  pageTitle = "Investigation detail",
  fixtureOptions,
  selectedAlertId,
  mobileNavigationOpen = false,
  mobileNavigationButtonRef,
  onOpenMobileNavigation,
  onSelectFixture,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-steel bg-surface/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            ref={mobileNavigationButtonRef}
            type="button"
            onClick={onOpenMobileNavigation}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-steel text-slate hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:hidden"
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={mobileNavigationOpen}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <p className="truncate text-[0.65rem] font-bold uppercase tracking-[0.15em] text-slate">
              Investigations
            </p>
            <p className="truncate text-sm font-extrabold text-ink">
              {pageTitle}
            </p>
          </div>
        </div>

        {fixtureOptions.length > 0 && (
          <FixtureSelector
            options={fixtureOptions}
            selectedAlertId={selectedAlertId}
            onSelect={onSelectFixture}
          />
        )}
      </div>
    </header>
  );
}

