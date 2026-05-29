"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getDefaultNetworkAllowlist } from "@/lib/client-api";

export function DefaultAllowlistSheetTrigger({
  children = "View default allowlist",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadDomains(): Promise<void> {
    if (loaded || loading) {
      return;
    }
    setLoading(true);
    try {
      const data = await getDefaultNetworkAllowlist();
      setDomains(data.domains);
      setLoaded(true);
    } catch (error) {
      toast.error("Failed to load default allowlist", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="link"
        className={`h-auto p-0 text-xs font-medium text-primary ${className ?? ""}`}
        onClick={() => {
          setOpen(true);
          void loadDomains();
        }}
      >
        {children}
      </Button>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            void loadDomains();
          }
        }}
      >
        <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Default allowlist</SheetTitle>
            <SheetDescription>
              Domains included when default network access is enabled.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <div className="p-4 text-sm text-foreground-muted">
                Loading domains...
              </div>
            ) : (
              <ul className="divide-y divide-border font-mono text-xs">
                {domains.map((domain) => (
                  <li key={domain} className="px-3 py-2 text-foreground-secondary">
                    {domain}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
