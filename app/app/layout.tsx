import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import "@fontsource-variable/anybody/wdth.css";
import "@fontsource-variable/figtree/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeeClass: study battles with real prize pools",
  description:
    "Turn course notes into a live quiz battle. Sponsors lock the prize on Solana before it starts; winners are paid the moment it ends.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1C1F45" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
