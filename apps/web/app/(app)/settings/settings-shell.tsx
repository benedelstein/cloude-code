export function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-14 md:py-16">
      <main className="mx-auto min-w-0 w-full max-w-5xl">{children}</main>
    </div>
  );
}
