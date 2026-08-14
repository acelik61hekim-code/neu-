import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bild wird erstellt",
  robots: { index: false, follow: false },
};

export default function ImageSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
