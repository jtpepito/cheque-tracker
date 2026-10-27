import type { Metadata } from "next";
import { headers } from "next/headers";
// Self-hosted from the geist package: Google Fonts fails behind the office HTTPS inspection.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cheque Desk",
  description: "How much will clear, from which company, on each of the next few days.",
};

// Applies a saved light/dark choice before the first paint.
const themeScript =
  "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Set by the middleware; the Content-Security-Policy allows only scripts carrying it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en-PH" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Browsers hide the nonce attribute from scripts, so React would report a mismatch. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
