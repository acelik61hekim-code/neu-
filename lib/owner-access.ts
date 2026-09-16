type VerifiedUser = { id?: string; email?: string; email_confirmed_at?: string } | null;

export function hasOwnerAccess(user: VerifiedUser): boolean {
  return Boolean(
    user?.id &&
    user.email_confirmed_at &&
    user.email?.trim().toLowerCase() === "info@kivideostudio.de",
  );
}
