import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { Footer } from "@/app/components/Footer";
import "./globals.css";

// Design-system faces (see tailwind.config.ts fontFamily), bundled in
// app/fonts rather than fetched from Google at build time so a Google Fonts
// outage can't break a deploy. Latin subset, variable weight; OFL licences
// alongside. Exposed as CSS variables; pages opt in via font-sans / font-serif.
const publicSans = localFont({
  src: [
    { path: "./fonts/PublicSans-Variable.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/PublicSans-Italic-Variable.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const sourceSerif = localFont({
  src: "./fonts/SourceSerif4-Variable.woff2",
  weight: "200 900",
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JobAgent — AI job search software for job seekers",
  description:
    "JobAgent is subscription software for job seekers. It matches open roles to your CV, tailors your CV and cover letter for each one, and applies for you. Free and paid plans.",
  openGraph: {
    title: "JobAgent — AI job search software for job seekers",
    description:
      "Subscription software for job seekers: CV-matched jobs, tailored applications, and one-click apply. Free and paid plans.",
    siteName: "JobAgent",
    type: "website",
  },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    shortcut: "/favicon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${publicSans.variable} ${sourceSerif.variable} antialiased bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100`}
      >
        <ThemeProvider>
          <div className="min-h-screen flex flex-col">
            <div className="flex-1">{children}</div>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
