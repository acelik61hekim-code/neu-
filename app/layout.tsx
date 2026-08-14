import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "KI-Video-Studio",
  description: "Erstelle KI-Videos aus einem einfachen Text-Prompt.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
