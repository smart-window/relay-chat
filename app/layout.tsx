import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });
const display = Fraunces({ variable: "--font-display", subsets: ["latin"] });

const productionUrl = "https://smart-window.github.io/relay-chat";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  metadataBase: new URL(`${productionUrl}/`),
  title: { default: "Relay", template: "%s · Relay" },
  description: "Private text, image, audio, voice, and video conversations in one calm space.",
  icons: { icon: `${basePath}/favicon.png`, shortcut: `${basePath}/favicon.png` },
  openGraph: {
    type: "website",
    title: "Relay — Conversations, closer",
    description: "Talk like you’re in the same room.",
    images: [{ url: `${productionUrl}/og.png`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Relay — Conversations, closer",
    description: "Talk like you’re in the same room.",
    images: [`${productionUrl}/og.png`],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${sans.variable} ${display.variable}`}>{children}</body></html>;
}
