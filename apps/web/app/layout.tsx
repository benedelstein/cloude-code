import type { Metadata } from "next";
import "./globals.css";
import { Sonner } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "☁️ Cloude Code",
  description: "Develop in the cloud.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Sonner />
      </body>
    </html>
  );
}
