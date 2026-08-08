import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { AppShell } from "../components/app-shell";
import { FixtureProvider } from "../components/fixture-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "Job Pulse Realtime",
    description:
      "Personal job monitoring, alerts, source health, and Talent workflow console.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Job Pulse Realtime",
      description: "Jobs, source health, alerts, and Talent workflows in one console.",
      images: [new URL("/og.png", metadataBase).href],
    },
    twitter: {
      card: "summary_large_image",
      images: [new URL("/og.png", metadataBase).href],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <FixtureProvider>
          <AppShell>{children}</AppShell>
        </FixtureProvider>
      </body>
    </html>
  );
}
