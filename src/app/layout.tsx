import type { Metadata } from "next";
import { AuthSessionLogger } from "@/components/dev/AuthSessionLogger";
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
        <AuthSessionLogger />
        {children}
      </body>
    </html>
  );
}
