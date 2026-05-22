import { BarChart3, type LucideIcon, Wallet } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface UsageNavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  /** Index route — match the path exactly so it isn't kept active on sub-routes. */
  end?: boolean;
}

const USAGE_NAV: UsageNavItem[] = [
  { title: "Usage", path: "/usage", icon: BarChart3, end: true },
  { title: "Budgets", path: "/usage/budgets", icon: Wallet },
];

/**
 * Two-column shell for the usage section — same left-rail / mobile-Select
 * pattern as SettingsLayout. The rail drives nested routes (`/usage` index =
 * Usage, `/usage/budgets` = Budgets) rendered into the `<Outlet/>`. Each
 * embedded page keeps its own PageHeader and owns its scroll container.
 */
export function UsageLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeItem =
    USAGE_NAV.find((item) =>
      item.end ? location.pathname === item.path : location.pathname.startsWith(item.path),
    ) ?? USAGE_NAV[0];

  return (
    <div className="flex flex-col flex-1 min-h-0 md:flex-row md:gap-6">
      {/* Mobile: Select picker above the content. */}
      <div className="md:hidden shrink-0 mb-4">
        <Select value={activeItem.path} onValueChange={(next) => navigate(next)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {USAGE_NAV.map((item) => (
              <SelectItem key={item.path} value={item.path}>
                {item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: left rail. */}
      <nav aria-label="Usage" className="hidden md:flex md:flex-col md:gap-0.5 md:w-48 shrink-0">
        {USAGE_NAV.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )
            }
          >
            <item.icon className="size-4 shrink-0" />
            <span>{item.title}</span>
          </NavLink>
        ))}
      </nav>

      {/* Content area — embedded pages own their own scroll container. */}
      <div className="flex flex-col flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
