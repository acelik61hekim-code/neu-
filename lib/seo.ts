import type { Metadata } from "next";

import { SITE_NAME, SITE_URL } from "@/lib/site";

export function productMetadata({
  title,
  description,
  path,
  keywords,
}: {
  title: string;
  description: string;
  path: string;
  keywords: string[];
}): Metadata {
  return {
    title,
    description,
    keywords,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "de_DE",
      url: path,
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export function productJsonLd({
  name,
  description,
  path,
  category,
  lowPrice,
  highPrice,
  offerCount,
  features,
  faqs,
}: {
  name: string;
  description: string;
  path: string;
  category: string;
  lowPrice: string;
  highPrice: string;
  offerCount: number;
  features: string[];
  faqs: Array<{ question: string; answer: string }>;
}) {
  const url = `${SITE_URL}${path}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name,
      description,
      url,
      applicationCategory: category,
      operatingSystem: "Web",
      inLanguage: "de-DE",
      featureList: features,
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "EUR",
        lowPrice,
        highPrice,
        offerCount,
        availability: "https://schema.org/InStock",
        url,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
  ];
}
