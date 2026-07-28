export const SITE_ORIGIN = "https://promotionsure.com.ng";
export const SITE_NAME = "PromotionSure";
export const SITE_LOGO_URL = `${SITE_ORIGIN}/logo/promotionsure-lockup.png`;

export const PUBLIC_PAGE_METADATA = Object.freeze({
  "/": {
    title: "PromotionSure | Public Service Promotion Exam Practice",
    description:
      "PromotionSure helps Nigerian public servants prepare for promotion examinations with objective questions, oral practice, timed practice sets, scores, and answer review.",
  },
  "/privacy": {
    title: "Privacy Policy | PromotionSure",
    description:
      "Learn how PromotionSure handles account, practice, payment, support, and technical information.",
  },
  "/terms": {
    title: "Terms of Service | PromotionSure",
    description:
      "Read the terms governing PromotionSure accounts, practice content, access, payments, refunds, and acceptable use.",
  },
  "/support": {
    title: "Support | PromotionSure",
    description:
      "Contact PromotionSure for help with sign-in, module access, payments, and account support.",
  },
});

export function normalizeSeoPath(pathname = "/") {
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function getPublicPageMetadata(pathname) {
  return PUBLIC_PAGE_METADATA[normalizeSeoPath(pathname)] ?? null;
}

export function getCanonicalUrl(pathname) {
  const normalizedPath = normalizeSeoPath(pathname);
  return normalizedPath === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${normalizedPath}`;
}

export function getHomeStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: SITE_NAME,
        publisher: {
          "@id": `${SITE_ORIGIN}/#organization`,
        },
      },
      {
        "@type": "OnlineBusiness",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: SITE_NAME,
        url: `${SITE_ORIGIN}/`,
        description:
          "An independent online practice platform for Nigerian public servants preparing for promotion examinations.",
        logo: {
          "@type": "ImageObject",
          url: SITE_LOGO_URL,
          width: 1148,
          height: 200,
        },
        founder: {
          "@type": "Person",
          name: "RASHEEDAH BUKOLA FAGBO",
        },
        email: "promotionsureapp@gmail.com",
        areaServed: {
          "@type": "Country",
          name: "Nigeria",
        },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "promotionsureapp@gmail.com",
          availableLanguage: "English",
        },
      },
    ],
  };
}

export function getPublicPageStructuredData(pathname, metadata) {
  const canonicalUrl = getCanonicalUrl(pathname);

  if (normalizeSeoPath(pathname) === "/") {
    return getHomeStructuredData();
  }

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: metadata.title,
    description: metadata.description,
    isPartOf: {
      "@id": `${SITE_ORIGIN}/#website`,
    },
    about: {
      "@id": `${SITE_ORIGIN}/#organization`,
    },
  };
}
