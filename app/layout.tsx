import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "CricVision Pro", description: "AI cricket biomechanics coach, virtual match simulator and analytics platform." };
export const viewport: Viewport = { themeColor: "#07120c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="no-print border-b border-white/10 px-4 py-3">
          <a href="/" className="text-lg font-extrabold tracking-tight">Cric<span className="text-lime-glow">Vision</span> Pro</a>
          <nav className="ml-6 inline-flex gap-4 text-sm text-white/70"><a href="/profile" className="hover:text-white">Player DNA</a></nav>
        </header>
        <main className="mx-auto max-w-7xl p-4">{children}</main>
      </body>
    </html>
  );
}
