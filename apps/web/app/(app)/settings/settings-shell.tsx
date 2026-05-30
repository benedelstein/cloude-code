import type { ReactNode } from "react";

export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-14 md:py-16">
      <main className="mx-auto min-w-0 w-full max-w-5xl">{children}</main>
    </div>
  );
}

export function SettingsPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-foreground-secondary">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
