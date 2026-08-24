import type { Metadata } from "next";

import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Anmelden oder registrieren",
  description: "Erstelle dein Kundenkonto und verwalte deine KI-Songs, Videos, Bilder und dein Abo.",
};

export default function SignInPage() {
  return <AuthForm />;
}
