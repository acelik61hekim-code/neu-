import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
