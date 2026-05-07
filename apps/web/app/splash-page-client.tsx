"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CloudButton } from "@/components/ui/cloud-button";
import { CloudBackground } from "@/components/backgrounds/cloud-background";
import { CloudBank } from "@/components/backgrounds/cloud-bank";
import { CloudIllustration } from "@/components/ui/cloud-illustration";
import { SiteFooter } from "@/components/site-footer";
import { ComputerCluster } from "./computer-cluster";
import { DeviceConnections } from "./device-connections";
import { HarnessIllustration } from "./harness-illustration";
import { StickyHeader } from "./sticky-header";

interface SplashPageClientProps {
  hasSessionCookie: boolean;
}

const TITLE_STROKE: CSSProperties = {
  WebkitTextStroke: "4px #1f2d3d",
  paintOrder: "stroke fill",
};

export function SplashPageClient({ hasSessionCookie }: SplashPageClientProps) {
  const router = useRouter();
  const { loading, isAuthenticated, login, authError } = useAuth();
  const [loginStarted, setLoginStarted] = useState(false);
  const hasDashboardAccess = isAuthenticated || (loading && hasSessionCookie);

  useEffect(() => {
    if (authError) {
      toast.error(authError);
    }
  }, [authError]);

  useEffect(() => {
    if (loginStarted && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, loginStarted, router]);

  const handleSignIn = () => {
    setLoginStarted(true);
    void login();
  };

  const renderPrimaryCTA = (size: "lg" | "xl" = "lg", label = "Get started") => {
    const sizeClass = size === "xl" ? "h-16 px-8 text-lg" : "h-14 px-6 text-base";
    if (hasDashboardAccess) {
      return (
        <CloudButton href="/dashboard" className={sizeClass}>
          {label}
          <ArrowRight className="h-5 w-5" />
        </CloudButton>
      );
    }
    return (
      <CloudButton className={sizeClass} disabled={loading} onClick={handleSignIn}>
        {label}
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ArrowRight className="h-5 w-5" />
        )}
      </CloudButton>
    );
  };

  const renderHeaderAuthButton = () => {
    if (hasDashboardAccess) {
      return (
        <CloudButton href="/dashboard" className="h-10 px-4 text-sm" variant="quiet">
          Go to dashboard
          <ArrowRight className="h-4 w-4" />
        </CloudButton>
      );
    }
    return (
      <CloudButton
        className="h-10 px-4 text-sm"
        disabled={loading}
        onClick={handleSignIn}
        variant="quiet"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Github className="h-4 w-4" />
        )}
        Sign in
      </CloudButton>
    );
  };

  return (
    <main className="relative bg-background-secondary text-foreground">
      <StickyHeader>{renderHeaderAuthButton()}</StickyHeader>

      <section className="relative z-10 h-svh overflow-x-clip">
        <CloudBackground />

        <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-5 pb-24 pt-20 text-center md:px-8">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[60%] w-[80%] max-w-2xl -translate-x-1/2 -translate-y-1/2"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.45) 35%, rgba(255,255,255,0) 70%)",
              filter: "blur(8px)",
            }}
          />
          <h1
            className="font-display text-5xl font-normal text-white leading-[0.96] tracking-normal md:text-7xl lg:text-8xl"
            style={TITLE_STROKE}
          >
            Cloude Code
          </h1>
          <p
            className="mt-4 max-w-xl text-pretty text-base text-secondary-foreground md:text-lg"
            style={{ textShadow: "0 0 10px rgba(255,255,255,0.85)" }}
          >
            Agent teams built for parallel scale.
          </p>
          {/* <p
            className="mt-2 max-w-xl text-pretty text-sm text-muted-foreground"
            style={{ textShadow: "0 0 10px rgba(255,255,255,0.85)" }}
          >
            Cloude Code gives agents their own full environment to work on, so you can
            scale up output without being limited by your own hardware.
          </p> */}

          <div className="mt-8 flex justify-center">{renderPrimaryCTA("lg")}</div>
        </div>
      </section>

      <FeaturesSection />
      <CTASection cta={renderPrimaryCTA("xl", "Get Started")} />
      <SiteFooter />
    </main>
  );
}

interface Feature {
  title: string;
  body: string;
  illustration: ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: "Environments for real work",
    body:
      "Laptops were made for humans to work during their workdays, not for agents to crank out code around the clock. Cloude Code gives each agent its own persistent computer to build, run, and test in — not just an ephemeral sandbox to edit files.",
    illustration: <ComputerCluster />,
  },
  {
    title: "Your favorite harness",
    body:
      "Cloude Code runs your preferred provider's own agent harness directly on its dev computer. Connect your Claude or OpenAI login — no API keys needed. More providers to come.",
    illustration: <HarnessIllustration />,
  },
  {
    title: "Always on, anywhere",
    body:
      "Monitor tasks from your phone or your laptop. Agents keep working while you don't.",
    illustration: <DeviceConnections />,
  },
];

function FeaturesSection() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Serious agents deserve their own computers.
          </h2>
          <p className="mt-4 text-sm text-muted-foreground">
            Give your agents the same tools you use, in their own isolated environment —
            free from the limitations of running on your own hardware.
          </p>
        </div>
        <div className="mt-24 flex flex-col gap-24 md:gap-32">
          {FEATURES.map((feature, i) => {
            const flipped = i % 2 === 1;
            return (
              <div
                key={feature.title}
                className="grid items-center gap-12 md:grid-cols-2 md:gap-20"
              >
                <div className={flipped ? "md:order-2" : ""}>
                  <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                    {feature.title}
                  </h3>
                  <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
                    {feature.body}
                  </p>
                </div>
                <div className={`flex justify-center ${flipped ? "md:order-1" : ""}`}>
                  <CloudIllustration flip={flipped} floatPhase={(i % 3) as 0 | 1 | 2}>
                    {feature.illustration}
                  </CloudIllustration>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CTASection({ cta }: { cta: ReactNode }) {
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-background-secondary via-sky-100 to-sky-200">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: "40vh",
          // Body of the bank is the top ~39% of the SVG (y=0..110 of viewBox 0..280
          // after flip). Translating up by that fraction lands the body-bumps
          // boundary at section top so overflow-hidden clips the body cleanly.
          transform: "translateY(-39%)",
        }}
      >
        <CloudBank flip className="h-full" fill="var(--color-background-secondary)" />
      </div>
      <div className="relative mx-auto max-w-3xl px-6 pt-32 pb-24 text-center md:px-8 md:pt-48 md:pb-32">
        <h2
          className="font-display text-3xl md:text-5xl font-normal text-white leading-[1.05]"
          style={TITLE_STROKE}
        >
          Start your agent team 
        </h2>
        <div className="mt-10 flex justify-center">{cta}</div>
      </div>
    </section>
  );
}
