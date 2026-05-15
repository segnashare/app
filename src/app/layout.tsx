import type { Metadata } from "next";
import { AuthSessionLogger } from "@/components/dev/AuthSessionLogger";
import { WebVitalsReporter } from "@/components/dev/WebVitalsReporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Segna App",
  description: "Mobile-first onboarding application",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {process.env.SEGNA_AUTH_SESSION_LOGGER === "1" ? <AuthSessionLogger /> : null}
        {process.env.NEXT_PUBLIC_SEGNA_WEB_VITALS === "1" ? <WebVitalsReporter /> : null}
        {children}
      </body>
    </html>
  );
}
