import type { Metadata } from "next";

import AccountDashboard from "@/components/AccountDashboard";

export const metadata: Metadata = { title: "Mein Konto und meine Inhalte", description: "Verwalte dein Song-Abo und deine erstellten Songs, Videos und Bilder." };

export default function AccountPage() { return <AccountDashboard />; }
