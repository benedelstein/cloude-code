import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

const WORDMARK_STROKE: CSSProperties = {
  WebkitTextStroke: "2px #1f2d3d",
  paintOrder: "stroke fill",
};

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How BZE, LLC collects, uses, and shares information through My Machines.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background-secondary text-foreground">
      <header className="border-b border-border bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between px-6 md:px-8">
          <Link
            href="/"
            className="font-display text-2xl font-normal leading-none text-white"
            style={WORDMARK_STROKE}
          >
            My Machines
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16 md:px-8 md:py-24">
        <div className="border-b border-border pb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">
            Legal
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Effective July 23, 2026
          </p>
        </div>

        <div className="mt-10 rounded-lg border border-border bg-white p-6 shadow-sm md:p-8">
          <p className="leading-7 text-foreground-secondary">
            This Privacy Policy explains how BZE, LLC (&quot;BZE,&quot;
            &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses, and
            shares information when you use the My Machines website, mobile app,
            APIs, and related services (the &quot;Service&quot;).
          </p>
        </div>

        <div className="mt-12 space-y-12">
          <PolicySection title="1. Information we collect">
            <p>
              We collect information you provide when you create an account, connect
              third-party services, or use My Machines. This may include account
              details, task instructions, messages, files, repository content, and
              other information needed to provide the Service.
            </p>
            <PolicyList>
              <li>
                <strong>Connected services.</strong> When you connect services such
                as GitHub or an AI provider, we receive and process the information
                needed to provide that connection.
              </li>
              <li>
                <strong>Usage information.</strong> We may collect basic technical
                information such as your IP address, browser or device type, and
                diagnostic or security logs.
              </li>
              <li>
                <strong>Cookies and local storage.</strong> We use necessary cookies
                and similar technologies to keep you signed in, remember preferences,
                and support core features.
              </li>
            </PolicyList>
          </PolicySection>

          <PolicySection title="2. How we use information">
            <p>
              We use information to operate and improve the Service, authenticate
              users, run requested tasks, connect with third-party services, provide
              support, protect the Service, and comply with legal obligations.
            </p>
            <p>
              My Machines processes task content and relevant repository context
              through AI providers and cloud development environments to perform
              the work you request.
            </p>
          </PolicySection>

          <PolicySection title="3. How we share information">
            <p>
              We share information with service providers that help us operate My
              Machines, including providers of hosting, cloud execution,
              authentication, AI processing, transcription, and notifications. We
              may also share information when you direct us to connect with another
              service.
            </p>
            <p>
              We may disclose information when required by law, to protect the
              Service or others, or as part of a merger, acquisition, financing, or
              sale of assets.
            </p>
            <p>
              We do not sell personal information or share it for cross-context
              behavioral advertising.
            </p>
          </PolicySection>

          <PolicySection title="4. Data retention and security">
            <p>
              We keep information for as long as reasonably necessary to provide the
              Service, meet legal obligations, resolve disputes, and protect against
              abuse. Retention periods vary depending on the information and why we
              process it.
            </p>
            <p>
              We use reasonable technical and organizational safeguards to protect
              information. No method of storage or transmission is completely
              secure.
            </p>
          </PolicySection>

          <PolicySection title="5. Your choices and rights">
            <p>
              You can delete sessions, disconnect supported integrations, or revoke
              access through a connected provider. Depending on where you live, you
              may also have rights to access, correct, or delete your personal
              information. To make a privacy request, email{" "}
              <a
                href="mailto:info@bze.llc"
                className="font-medium text-accent underline underline-offset-4"
              >
                info@bze.llc
              </a>
              .
            </p>
          </PolicySection>

          <PolicySection title="6. Children">
            <p>
              The Service is not directed to children under 13, and we do not
              knowingly collect personal information from children under 13. If you
              believe a child has provided personal information to us, please
              contact us so we can take appropriate action.
            </p>
          </PolicySection>

          <PolicySection title="7. International use">
            <p>
              BZE, LLC is based in the United States. If you use the Service from
              another country, your information may be processed in the United
              States and other countries where our service providers operate.
            </p>
          </PolicySection>

          <PolicySection title="8. Changes and contact">
            <p>
              We may update this Privacy Policy as the Service changes. We will post
              the updated policy on this page and revise the effective date above.
            </p>
            <p>
              For privacy questions or requests, contact BZE, LLC at{" "}
              <a
                href="mailto:info@bze.llc"
                className="font-medium text-accent underline underline-offset-4"
              >
                info@bze.llc
              </a>
              .
            </p>
          </PolicySection>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function PolicySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-base leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function PolicyList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-3 pl-6 marker:text-accent">{children}</ul>;
}
