import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Song wird erstellt",
  robots: { index: false, follow: false },
};

export default function SongSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
