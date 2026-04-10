import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { to: "/rules", label: "Rules", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { to: "/changes", label: "Changes", icon: "M3 7h5l2 3h11M3 17h18M3 12h18" },
  { to: "/reviewers", label: "Reviewers", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { to: "/evals", label: "Evals", icon: "M9 17v-6m3 6V7m3 10v-4m6 6H3a2 2 0 01-2-2V5a2 2 0 012-2h18a2 2 0 012 2v12a2 2 0 01-2 2z" },
  { to: "/config", label: "Configuration", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { to: "/reviews", label: "Reviews", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
];

export function Layout() {
  const location = useLocation();
  const isChangesPage = location.pathname.startsWith("/changes");

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className={cn(
        "min-w-0 flex-1 px-8 py-8",
        isChangesPage ? "overflow-hidden" : "overflow-y-auto",
      )}>
        <div className={cn(
          isChangesPage ? "flex h-full flex-col" : "mx-auto w-full max-w-5xl",
        )}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <nav className="flex w-60 flex-col border-r border-slate-700/50 bg-slate-800">
      <BrandHeader />
      <div className="flex flex-col gap-0.5 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </div>
      <VersionFooter />
    </nav>
  );
}

function BrandHeader() {
  return (
    <div className="border-b border-slate-700/50 px-5 py-5">
      <h1 className="text-sm font-semibold tracking-wide text-white">
        Intrusive Thoughts
      </h1>
      <p className="mt-0.5 text-xs text-slate-400">Let the voices guide you</p>
    </div>
  );
}

function SidebarLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-slate-700/60 font-medium text-white"
            : "text-slate-300 hover:bg-slate-700/40 hover:text-white",
        ].join(" ")
      }
    >
      <NavIcon path={icon} />
      {label}
    </NavLink>
  );
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="h-4 w-4 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

function VersionFooter() {
  return (
    <div className="mt-auto border-t border-slate-700/50 px-5 py-4">
      <p className="text-xs text-slate-500">v0.1.0</p>
    </div>
  );
}
