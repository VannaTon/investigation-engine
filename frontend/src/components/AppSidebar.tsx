import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  FileSearch,
  GitBranch,
  LayoutDashboard,
  ListOrdered,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Telescope,
  X,
  type LucideIcon,
} from "lucide-react";

export interface InvestigationSectionItem {
  id: string;
  label: string;
  Icon: LucideIcon;
}

export interface InvestigationSectionGroup {
  id: "investigation" | "evidence" | "deep-evidence";
  label: string;
  Icon: LucideIcon;
  defaultExpanded: boolean;
  items: InvestigationSectionItem[];
}

export const investigationSectionGroups: InvestigationSectionGroup[] = [
  {
    id: "investigation",
    label: "Investigation",
    Icon: Telescope,
    defaultExpanded: true,
    items: [
      { id: "candidate-ranking", label: "Candidate ranking", Icon: ListOrdered },
      { id: "ai-explanation", label: "AI explanation", Icon: MessageSquareText },
    ],
  },
  {
    id: "evidence",
    label: "Evidence",
    Icon: FileSearch,
    defaultExpanded: false,
    items: [
      { id: "evidence-priority", label: "Evidence priority", Icon: SlidersHorizontal },
      { id: "trace-path", label: "Trace path", Icon: GitBranch },
      { id: "findings", label: "Findings", Icon: FileSearch },
      { id: "timeline", label: "Timeline", Icon: Clock3 },
    ],
  },
  {
    id: "deep-evidence",
    label: "Deep evidence",
    Icon: Database,
    defaultExpanded: false,
    items: [
      { id: "evidence-groups", label: "Evidence groups", Icon: Boxes },
      { id: "relationships", label: "Relationships", Icon: Network },
      { id: "telemetry", label: "Telemetry", Icon: Database },
      { id: "integrity", label: "Integrity issues", Icon: ShieldCheck },
    ],
  },
];

export const investigationSectionIds = [
  "overview",
  ...investigationSectionGroups.flatMap((group) =>
    group.items.map((item) => item.id),
  ),
];

interface SidebarNavItemProps {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  currentType: "page" | "location";
  nested?: boolean;
  onClick?: () => void;
}

export function SidebarNavItem({
  href,
  label,
  Icon,
  active,
  collapsed,
  currentType,
  nested = false,
  onClick,
}: SidebarNavItemProps) {
  const className =
    "flex min-h-10 items-center gap-3 rounded-lg border px-3 py-2 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink " +
    (nested ? "ml-3 " : "") +
    (active
      ? "border-steel bg-canvas text-ink"
      : "border-transparent text-slate hover:bg-canvas hover:text-ink");

  return (
    <a
      href={href}
      className={className}
      aria-current={active ? currentType : undefined}
      aria-label={label}
      title={collapsed ? label : undefined}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className={collapsed ? "lg:hidden" : undefined}>{label}</span>
    </a>
  );
}

interface AppSidebarProps {
  showInvestigationNavigation?: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  investigationHref: string;
  activeSectionId: string;
  onNavigateSection: (sectionId: string) => void;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}

export function AppSidebar({
  showInvestigationNavigation = true,
  collapsed,
  mobileOpen,
  investigationHref,
  activeSectionId,
  onNavigateSection,
  onToggleCollapsed,
  onCloseMobile,
}: AppSidebarProps) {
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        investigationSectionGroups.map((group) => [
          group.id,
          group.defaultExpanded,
        ]),
      ),
  );
  const widthClass = collapsed ? "lg:w-[4.5rem]" : "lg:w-64";
  const visibilityClass = mobileOpen
    ? "visible translate-x-0"
    : "invisible -translate-x-full lg:visible lg:translate-x-0";

  useEffect(() => {
    if (mobileOpen) {
      mobileCloseButtonRef.current?.focus();
    }
  }, [mobileOpen]);

  useEffect(() => {
    const activeGroup = investigationSectionGroups.find((group) =>
      group.items.some((item) => item.id === activeSectionId),
    );
    if (!activeGroup) return;

    setExpandedGroups((current) =>
      current[activeGroup.id]
        ? current
        : { ...current, [activeGroup.id]: true },
    );
  }, [activeSectionId]);

  const navigateToSection = (sectionId: string) => {
    onNavigateSection(sectionId);
    onCloseMobile();

    if (typeof window !== "undefined") {
      window.requestAnimationFrame?.(() => {
        document.getElementById(sectionId)?.focus({ preventScroll: true });
      });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (mobileOpen && event.key === "Escape") {
      event.preventDefault();
      onCloseMobile();
    }
  };

  return (
    <aside
      id="app-sidebar"
      className={
        "fixed inset-y-0 left-0 z-50 flex h-screen w-72 shrink-0 flex-col border-r border-steel bg-surface transition-[width,transform] duration-200 motion-reduce:transition-none lg:sticky lg:top-0 lg:z-20 " +
        widthClass +
        " " +
        visibilityClass
      }
      aria-label="Application navigation"
      onKeyDown={handleKeyDown}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-steel px-4">
        <a
          href={investigationHref}
          className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          aria-label="Observability Platform"
          title={collapsed ? "Observability Platform" : undefined}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink text-white">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className={collapsed ? "min-w-0 lg:hidden" : "min-w-0"}>
            <span className="block truncate text-sm font-extrabold tracking-tight text-ink">
              Observability Platform
            </span>
            <span className="block text-[0.62rem] font-bold uppercase tracking-[0.16em] text-slate">
              Incident investigation
            </span>
          </span>
        </a>
        <button
          ref={mobileCloseButtonRef}
          type="button"
          onClick={onCloseMobile}
          className="grid h-9 w-9 place-items-center rounded-md border border-steel text-slate hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div>
          <p
            className={
              "px-3 text-[0.62rem] font-extrabold uppercase tracking-[0.16em] text-slate " +
              (collapsed ? "lg:sr-only" : "")
            }
          >
            Product
          </p>
          <div className="mt-2">
            <SidebarNavItem
              href={investigationHref}
              label="Investigations"
              Icon={Search}
              active
              collapsed={collapsed}
              currentType="page"
              onClick={onCloseMobile}
            />
          </div>
        </div>

        {showInvestigationNavigation && <div className="my-4 border-t border-steel" />}

        {showInvestigationNavigation && <div aria-label="Investigation sections">
          <p
            className={
              "px-3 text-[0.62rem] font-extrabold uppercase tracking-[0.16em] text-slate " +
              (collapsed ? "lg:sr-only" : "")
            }
          >
            Investigation
          </p>
          <div className="mt-2 space-y-1">
            <SidebarNavItem
              href="#overview"
              label="Overview"
              Icon={LayoutDashboard}
              active={activeSectionId === "overview"}
              collapsed={collapsed}
              currentType="location"
              onClick={() => navigateToSection("overview")}
            />

            {investigationSectionGroups.map((group) => {
              const expanded = expandedGroups[group.id];
              const GroupIcon = group.Icon;
              const ChevronIcon = expanded ? ChevronDown : ChevronRight;
              const controlsId = `sidebar-group-${group.id}`;

              return (
                <div key={group.id}>
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left text-sm font-bold text-slate transition-colors hover:bg-canvas hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    aria-expanded={!collapsed && expanded}
                    aria-controls={controlsId}
                    aria-label={
                      collapsed
                        ? `Open ${group.label} navigation`
                        : `${expanded ? "Collapse" : "Expand"} ${group.label}`
                    }
                    title={collapsed ? group.label : undefined}
                    onClick={() => {
                      if (collapsed) {
                        setExpandedGroups((current) => ({
                          ...current,
                          [group.id]: true,
                        }));
                        onToggleCollapsed();
                        return;
                      }

                      setExpandedGroups((current) => ({
                        ...current,
                        [group.id]: !current[group.id],
                      }));
                    }}
                  >
                    <GroupIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span
                      className={
                        collapsed
                          ? "min-w-0 flex-1 lg:hidden"
                          : "min-w-0 flex-1"
                      }
                    >
                      {group.label}
                    </span>
                    <ChevronIcon
                      className={
                        collapsed
                          ? "h-4 w-4 shrink-0 lg:hidden"
                          : "h-4 w-4 shrink-0"
                      }
                      aria-hidden="true"
                    />
                  </button>

                  {expanded && (
                    <div
                      id={controlsId}
                      className={`mt-1 space-y-1 ${collapsed ? "lg:hidden" : ""}`}
                    >
                      {group.items.map((item) => (
                        <SidebarNavItem
                          key={item.id}
                          href={`#${item.id}`}
                          label={item.label}
                          Icon={item.Icon}
                          active={activeSectionId === item.id}
                          collapsed={false}
                          currentType="location"
                          nested
                          onClick={() => navigateToSection(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>}
      </nav>

      <div className="shrink-0 border-t border-steel p-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="hidden min-h-10 w-full items-center gap-3 rounded-lg border border-steel px-3 py-2 text-sm font-bold text-slate hover:bg-canvas hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-controls="app-sidebar"
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : undefined}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span className={collapsed ? "lg:hidden" : undefined}>
            {collapsed ? "Expand" : "Collapse"}
          </span>
        </button>
      </div>
    </aside>
  );
}


