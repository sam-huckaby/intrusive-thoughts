import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/rules", label: "Rules" },
  { to: "/config", label: "Config" },
  { to: "/prompt", label: "Prompt" },
  { to: "/reviews", label: "Reviews" },
];

export function Layout() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <nav className="w-56 bg-gray-900 text-white p-4 flex flex-col gap-1">
      <h1 className="text-lg font-bold mb-6 px-3">intrusive-thoughts</h1>
      {NAV_ITEMS.map((item) => (
        <SidebarLink key={item.to} to={item.to} label={item.label} />
      ))}
    </nav>
  );
}

function SidebarLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block px-3 py-2 rounded text-sm ${isActive ? "bg-gray-700 font-medium" : "hover:bg-gray-800"}`
      }
    >
      {label}
    </NavLink>
  );
}
