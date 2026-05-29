"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SETTINGS_NAV_ITEMS = [
  { href: "/settings", label: "General" },
  { href: "/settings/environments", label: "Environments" },
];

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-full overflow-y-auto px-4 py-14 md:py-16">
      <div className="mx-auto grid w-full max-w-6xl gap-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <aside className="md:pt-1">
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
          <nav className="mt-6 flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {SETTINGS_NAV_ITEMS.map((item) => {
              const active = pathname === item.href
                || (item.href !== "/settings" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
