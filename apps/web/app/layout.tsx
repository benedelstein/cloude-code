import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Sonner } from "@/components/ui/sonner";

const caprasimo = localFont({
  src: "./fonts/caprasimo-latin-400-normal.woff2",
  variable: "--font-caprasimo",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "My Machines",
    template: "%s | My Machines",
  },
  description: "Develop in the cloud.",
  openGraph: {
    title: {
      default: "My Machines",
      template: "%s | My Machines",
    },
    description: "Develop in the cloud.",
    siteName: "My Machines",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={caprasimo.variable}>
      <body className="antialiased">
        {children}
        <Sonner />
      </body>
    </html>
  );
}
