import type { Metadata } from "next";

import PasswordUpdateForm from "@/components/PasswordUpdateForm";

export const metadata: Metadata = { title: "Neues Passwort festlegen" };

export default function PasswordUpdatePage() {
  return <PasswordUpdateForm />;
}
