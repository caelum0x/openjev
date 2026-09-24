import { type ReactNode, useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookA,
  BookMarked,
  BookOpen,
  BookOpenCheck,
  Boxes,
  Building2,
  CircleHelp,
  CircuitBoard,
  Code2,
  Cpu,
  FlaskConical,
  FolderKanban,
  Gauge,
  GitCompare,
  GraduationCap,
  History,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  Map,
  Newspaper,
  PanelLeft,
  Play,
  Plug,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Terminal,
  Activity,
  SlidersHorizontal,
  GitCompareArrows,
  Trophy,
} from "lucide-react";
import { Mark } from "./mark";
import { cn } from "@/lib/utils";
import { COOKBOOKS } from "@/lib/jev/cookbooks";
import { UserButton } from "@/lib/auth/gates";

// Console: the working surfaces of the app (build, run, operate).
const CONSOLE_NAV = [
  { to: "/", label: "Home", icon: LayoutGrid },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/system-one", label: "System One", icon: Cpu },
  { to: "/playground", label: "Playground", icon: Play },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/decisions", label: "Decisions", icon: Boxes },
  { to: "/evals", label: "Evals", icon: FlaskConical },
  { to: "/calibrations", label: "Calibrations", icon: SlidersHorizontal },
  { to: "/shadow", label: "Shadow mode", icon: GitCompareArrows },
  { to: "/usage", label: "Usage", icon: Activity },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/keys", label: "API Keys", icon: KeyRound },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/self-hosting", label: "Self-hosting", icon: Server },
  { to: "/skill", label: "Agent skill", icon: Sparkles },
] as const;

// Product: marketing + reference pages that explain and position the product.
const PRODUCT_NAV = [
  { to: "/benchmarks", label: "Benchmarks", icon: Gauge },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/models", label: "Models", icon: Boxes },
  { to: "/status", label: "Status", icon: Activity },
  { to: "/pricing", label: "Pricing", icon: Tag },
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/solutions", label: "Solutions", icon: Building2 },
  { to: "/use-cases", label: "Use cases", icon: Layers },
  { to: "/guides", label: "Guides", icon: GraduationCap },
  { to: "/sdks", label: "SDKs", icon: Code2 },
  { to: "/api-explorer", label: "API Explorer", icon: Terminal },
  { to: "/reference", label: "API Reference", icon: BookMarked },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/tutorials", label: "Tutorials", icon: BookOpenCheck },
  { to: "/docs", label: "Documentation", icon: BookOpen },
  { to: "/backends", label: "Backends", icon: CircuitBoard },
  { to: "/roadmap", label: "Roadmap", icon: Map },
  { to: "/faq", label: "FAQ", icon: CircleHelp },
  { to: "/glossary", label: "Glossary", icon: BookA },
  { to: "/blog", label: "Blog", icon: Newspaper },
  { to: "/changelog", label: "Changelog", icon: History },
  { to: "/privacy", label: "Data Policy", icon: Lock },
  { to: "/security", label: "Trust Center", icon: ShieldCheck },
  { to: "/about", label: "About", icon: Info },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("openjev_sidebar");
    if (saved === "collapsed") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("openjev_sidebar", next ? "collapsed" : "open");
      return next;
    });
  }

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-bg/70 md:hidden"
          aria-label="Close sidebar"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "z-50 flex flex-col border-r border-border bg-inset",
          "fixed inset-y-0 left-0 w-60 transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "max-md:-translate-x-full",
          "md:static md:transition-[width]",
          collapsed ? "md:w-16" : "md:w-60",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center gap-2.5 border-b border-border px-3",
            collapsed && "md:justify-center md:px-0",
          )}
        >
          <Mark className="size-5 shrink-0" />
          <div className={cn("min-w-0", collapsed && "md:hidden")}>
            <p className="truncate text-sm font-medium tracking-tight">OpenJev</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              System One
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <p
            className={cn(
              "px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-subtle",
              collapsed && "md:hidden",
            )}
          >
            Console
          </p>
          {CONSOLE_NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={cn(
                  "mb-0.5 flex h-11 items-center gap-2.5 rounded-sm px-2.5 text-sm transition-colors duration-150",
                  active
                    ? "bg-raised text-fg"
                    : "text-muted hover:bg-raised/60 hover:text-fg",
                  collapsed && "md:justify-center md:px-0",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
              </Link>
            );
          })}

          <p
            className={cn(
              "px-2 pb-2 pt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-subtle",
              collapsed && "md:hidden",
            )}
          >
            Product
          </p>
          {PRODUCT_NAV.map((item) => {
            const active =
              pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={cn(
                  "mb-0.5 flex h-11 items-center gap-2.5 rounded-sm px-2.5 text-sm transition-colors duration-150",
                  active
                    ? "bg-raised text-fg"
                    : "text-muted hover:bg-raised/60 hover:text-fg",
                  collapsed && "md:justify-center md:px-0",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
              </Link>
            );
          })}

          <p
            className={cn(
              "px-2 pb-2 pt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-subtle",
              collapsed && "md:hidden",
            )}
          >
            Cookbooks
          </p>
          {COOKBOOKS.map((c) => {
            const active = pathname === c.href;
            return (
              <Link
                key={c.id}
                to="/cookbooks/$id"
                params={{ id: c.id }}
                title={c.title}
                className={cn(
                  "mb-0.5 flex h-11 items-center gap-2.5 rounded-sm px-2.5 text-sm transition-colors duration-150",
                  active
                    ? "bg-raised text-fg"
                    : "text-muted hover:bg-raised/60 hover:text-fg",
                  collapsed && "md:justify-center md:px-0",
                )}
              >
                <ScrollText className="size-4 shrink-0" />
                <span className={cn("truncate", collapsed && "md:hidden")}>
                  {c.title}
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            "border-t border-border px-3 py-3",
            collapsed && "md:px-2",
          )}
        >
          <p
            className={cn(
              "truncate text-xs text-muted",
              collapsed && "md:hidden",
            )}
          >
            Personal org
          </p>
          <p
            className={cn(
              "truncate font-mono text-[10px] text-subtle",
              collapsed && "md:hidden",
            )}
          >
            wire-compatible with System One v1 API
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/90 px-3 backdrop-blur-sm md:px-5">
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-sm text-muted hover:bg-raised hover:text-fg md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open sidebar"
          >
            <PanelLeft className="size-4" />
          </button>
          <button
            type="button"
            className="hidden size-11 items-center justify-center rounded-sm text-muted hover:bg-raised hover:text-fg md:flex"
            onClick={toggleCollapsed}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="size-4" />
          </button>
          <span className="font-mono text-xs text-subtle">
            POST /api/v1/systemone
          </span>
          <div className="ml-auto">
            <UserButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
