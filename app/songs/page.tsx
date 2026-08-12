import { redirect } from "next/navigation";

export default function SongsRedirectPage() {
  redirect("/?studio=song");
}
