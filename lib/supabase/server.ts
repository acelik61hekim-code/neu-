import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";

export function createSupabaseServerClient() {
  const { url, key } = getSupabaseConfig();
  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components dürfen Cookies nicht direkt schreiben.
          // Die Middleware übernimmt dort das Aktualisieren der Sitzung.
        }
      },
    },
  });
}

export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
