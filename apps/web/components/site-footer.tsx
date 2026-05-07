import Link from "next/link";
import type { CSSProperties } from "react";

const WORDMARK_STROKE: CSSProperties = {
  WebkitTextStroke: "2px #1f2d3d",
  paintOrder: "stroke fill",
};

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background-secondary pt-32 pb-48">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div>
          <span
            className="font-display text-2xl font-normal text-white leading-none"
            style={WORDMARK_STROKE}
          >
            Cloude Code
          </span>
          <p className="mt-4 text-sm text-muted-foreground">
            "Works on my machines"
          </p>
        </div>
        <div className="flex gap-16">
          <FooterColumn
            heading="Product"
            links={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Sign in", href: "/" },
            ]}
          />
          <FooterColumn
            heading="Legal"
            links={[
              { label: "Privacy", href: "#" },
              { label: "Terms", href: "#" },
            ]}
          />
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-5xl items-center justify-between px-6 text-xs text-muted-foreground sm:px-8">
        <span>© {new Date().getFullYear()} BZE, LLC</span>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{heading}</h4>
      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
        {links.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
