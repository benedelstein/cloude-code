import type { Metadata, Viewport } from "next";
import { Caprasimo } from "next/font/google";
import "./globals.css";
import { Sonner } from "@/components/ui/sonner";

const caprasimo = Caprasimo({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-caprasimo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cloude Code",
  description: "Develop in the cloud.",
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
