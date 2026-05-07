"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Github, Laptop, Loader2, Monitor, Smartphone } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CloudButton } from "@/components/ui/cloud-button";
import { CloudBackground } from "@/components/backgrounds/cloud-background";
import { CloudIllustration } from "@/components/ui/cloud-illustration";
import { SiteFooter } from "@/components/site-footer";

interface SplashPageClientProps {
  hasSessionCookie: boolean;
}

const TITLE_STROKE: CSSProperties = {
  WebkitTextStroke: "4px #1f2d3d",
  paintOrder: "stroke fill",
};

const WORDMARK_STROKE: CSSProperties = {
  WebkitTextStroke: "2px #1f2d3d",
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
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ArrowRight className="h-5 w-5" />
        )}
        {label}
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

        <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-5 pb-24 pt-20 text-center sm:px-8">
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
            className="font-display text-5xl font-normal text-white leading-[0.96] tracking-normal sm:text-7xl lg:text-8xl"
            style={TITLE_STROKE}
          >
            Cloude Code
          </h1>
          <p
            className="mt-4 max-w-xl text-pretty text-base text-secondary-foreground sm:text-lg"
            style={{ textShadow: "0 0 10px rgba(255,255,255,0.85)" }}
          >
            IDK WHAT TO SAY HERE.
          </p>
          <p
            className="mt-2 max-w-xl text-pretty text-sm text-muted-foreground"
            style={{ textShadow: "0 0 10px rgba(255,255,255,0.85)" }}
          >
            Cloude Code gives agents their own full environment to work on, so you can
            scale up output without being limited by your own hardware.
          </p>

          <div className="mt-8 flex justify-center">{renderPrimaryCTA("lg")}</div>
        </div>
      </section>

      <FeaturesSection />
      <CTASection cta={renderPrimaryCTA("xl", "Start Building")} />
      <SiteFooter />
    </main>
  );
}

function StickyHeader({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > window.innerHeight * 0.5);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-20">
      <div
        className={`absolute inset-0 border-b border-black/5 bg-white/85 backdrop-blur-sm transition-opacity duration-300 ${
          scrolled ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="relative flex h-full items-center justify-between px-5 sm:px-8">
        <span
          className={`font-display text-xl font-normal text-white leading-none transition-all duration-300 motion-reduce:transition-none sm:text-2xl ${
            scrolled
              ? "translate-y-0 opacity-100"
              : "-translate-y-1 opacity-0 motion-reduce:translate-y-0"
          }`}
          style={WORDMARK_STROKE}
          aria-hidden={!scrolled}
        >
          Cloude Code
        </span>
        <div>{children}</div>
      </div>
    </header>
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
    illustration: <ParallelComputersIllustration />,
  },
  {
    title: "Your favorite harness",
    body:
      "Cloude Code runs your preferred provider's own agent harness directly. Connect your Claude or OpenAI login — no API keys needed. More providers to come.",
    illustration: <HarnessIllustration />,
  },
  {
    title: "Always on, anywhere",
    body:
      "Kick off a task from your phone or your laptop. Agents keep working while you don't.",
    illustration: <AnywhereIllustration />,
  },
];

function FeaturesSection() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Serious agents deserve their own computers.
          </h2>
        </div>
        <div className="mt-24 flex flex-col gap-24 sm:gap-32">
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

// Deterministic Poisson-disk-like sampler — picks ~N points inside the box
// with each pair separated by at least `minDist`, so the cluster feels
// scattered but never overlaps. Seeded so the layout is stable across
// renders (and SSR).
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

interface Bubble {
  x: number;
  y: number;
  size: number;
}

function generateCluster({
  width,
  height,
  count,
  sizeRange,
  seed,
}: {
  width: number;
  height: number;
  count: number;
  sizeRange: [number, number];
  seed: number;
}): Bubble[] {
  const rand = seededRandom(seed);
  const points: Bubble[] = [];
  const maxAttempts = 6000;

  for (let attempt = 0; attempt < maxAttempts && points.length < count; attempt++) {
    const size = sizeRange[0] + rand() * (sizeRange[1] - sizeRange[0]);
    const x = rand() * (width - size);
    const y = rand() * (height - size);
    const padding = -2; // slight overlap allowed for tighter packing

    const collides = points.some((p) => {
      const cx = x + size / 2;
      const cy = y + size / 2;
      const pcx = p.x + p.size / 2;
      const pcy = p.y + p.size / 2;
      const dx = cx - pcx;
      const dy = cy - pcy;
      const minDist = (size + p.size) / 2 + padding;
      return dx * dx + dy * dy < minDist * minDist;
    });

    if (!collides) points.push({ x, y, size });
  }

  return points;
}

const MONITOR_CLUSTER = generateCluster({
  width: 360,
  height: 260,
  count: 22,
  sizeRange: [48, 80],
  seed: 11,
});
// Mark one of the larger bubbles as "live" so the green dot reads.
const LIVE_INDEX = MONITOR_CLUSTER.reduce(
  (best, b, i) => (b.size > MONITOR_CLUSTER[best].size ? i : best),
  0,
);

function ParallelComputersIllustration() {
  return (
    <div className="relative h-[260px] w-[360px]">
      {MONITOR_CLUSTER.map((m, i) => (
        <div
          key={i}
          className="absolute flex items-center justify-center rounded-full bg-sky-100"
          style={{ left: m.x, top: m.y, width: m.size, height: m.size }}
        >
          <Monitor
            className="text-sky-700"
            strokeWidth={1.75}
            style={{ width: m.size * 0.5, height: m.size * 0.5 }}
          />
          {i === LIVE_INDEX && (
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function HarnessIllustration() {
  return (
    <div className="relative h-48 w-64 sm:h-56 sm:w-72">
      <Image
        src="/claude_code_icon.svg"
        alt="Claude Code"
        width={96}
        height={96}
        className="absolute left-1/2 top-2 h-20 w-20 -translate-x-1/2 object-contain sm:h-24 sm:w-24"
      />
      <Image
        src="/openai_logo.svg"
        alt="OpenAI"
        width={88}
        height={88}
        className="absolute bottom-4 left-4 h-20 w-20 object-contain sm:h-24 sm:w-24"
      />
      <Image
        src="/gemini_logo.svg"
        alt="Gemini"
        width={88}
        height={88}
        className="absolute bottom-8 right-2 h-20 w-20 object-contain sm:h-24 sm:w-24"
      />
    </div>
  );
}

function AnywhereIllustration() {
  return (
    <div className="flex items-center gap-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sky-100">
        <Smartphone className="h-9 w-9 text-sky-700" strokeWidth={1.75} />
      </div>
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
      </span>
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sky-100">
        <Laptop className="h-9 w-9 text-sky-700" strokeWidth={1.75} />
      </div>
    </div>
  );
}

function CTASection({ cta }: { cta: ReactNode }) {
  return (
    <section className="relative py-24 text-center sm:py-32">
      <div className="mx-auto max-w-3xl px-6 sm:px-8">
        <h2
          className="font-display text-4xl font-normal text-white leading-[1.05] sm:text-6xl"
          style={TITLE_STROKE}
        >
          Footer CTA goes here.
        </h2>
        {/* <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
          Spin up as many agents as you have ideas. Cloude Code handles the machines.
        </p> */}
        <div className="mt-10 flex justify-center">{cta}</div>
      </div>
    </section>
  );
}
