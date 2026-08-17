import type { Metadata, Viewport } from "next";
import { inter, instrumentSerif, instrumentSerifItalic } from "@/lib/fonts";
import { AppShell } from "@/components/app-shell";
import { ThemeInit } from "@/components/theme-init";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StudentCareer AI",
    template: "%s · StudentCareer AI",
  },
  description:
    "Secure student career platform: profile-based job matching, verified ATS discovery, and guided application preparation.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "StudentCareer AI" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} ${instrumentSerifItalic.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeInit />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
