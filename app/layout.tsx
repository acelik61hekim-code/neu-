import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";

import PwaInstaller from "@/components/PwaInstaller";
import SiteFooter from "@/components/SiteFooter";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const viewport: Viewport = {
  themeColor: "#08080f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "KI Video Studio – Videos, Songs und Bilder mit KI erstellen",
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: SITE_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      {
        url: "/app-icon/192",
        type: "image/png",
        sizes: "192x192",
      },
      {
        url: "/app-icon/512",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/app-icon/180",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
  keywords: [
    "KI Video erstellen",
    "KI Song erstellen",
    "KI Bilder erstellen",
    "Text zu Video KI",
    "KI Videogenerator",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "de_DE",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "KI Video Studio – Videos, Songs und Bilder mit KI",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "KI Video Studio – Kreativstudio mit KI",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  email: "info@kivideostudio.de",
  inLanguage: "de-DE",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        {children}
        <SiteFooter />
        <PwaInstaller />
        <Analytics />
      </body>
    </html>
  );
}
