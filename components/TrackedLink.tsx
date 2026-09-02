"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import type { ReactNode } from "react";

type TrackedLinkProps = {
  href: string;
  className?: string;
  children: ReactNode;
  location: string;
  ariaLabel?: string;
};

export default function TrackedLink({
  href,
  className,
  children,
  location,
  ariaLabel,
}: TrackedLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      aria-label={ariaLabel}
      onClick={() =>
        track("landing_cta_clicked", {
          location,
          target: href,
        })
      }
    >
      {children}
    </Link>
  );
}
