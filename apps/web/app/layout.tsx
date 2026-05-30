import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/auth/AuthGate";
import { WizardProvider } from "@/components/wizard/WizardProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "icaro · rocket simulation",
  description: "Run a rocket flight simulation from your OpenRocket design.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Auth + wizard state live at the root so they persist across the
            wizard (/) and the results page (/results/[runId]). */}
        <AuthGate>
          <WizardProvider>{children}</WizardProvider>
        </AuthGate>
      </body>
    </html>
  );
}
