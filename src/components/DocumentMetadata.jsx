import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  getCanonicalUrl,
  getPublicPageMetadata,
  getPublicPageStructuredData,
  SITE_LOGO_URL,
  SITE_NAME,
} from "../lib/seoMetadata";

function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector);

  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
}

function upsertCanonical(url) {
  let canonical = document.head.querySelector('link[rel="canonical"]');

  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }

  canonical.setAttribute("href", url);
}

function updateStructuredData(pathname, metadata) {
  let script = document.getElementById("site-identity-structured-data");

  if (!script) {
    script = document.createElement("script");
    script.id = "site-identity-structured-data";
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }

  script.textContent = JSON.stringify(getPublicPageStructuredData(pathname, metadata));
}

export function DocumentMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    const metadata = getPublicPageMetadata(pathname);

    if (!metadata) {
      upsertMeta('meta[name="robots"]', {
        name: "robots",
        content: "noindex, nofollow",
      });
      document.head.querySelector('link[rel="canonical"]')?.remove();
      document.getElementById("site-identity-structured-data")?.remove();
      return;
    }

    const canonicalUrl = getCanonicalUrl(pathname);

    document.title = metadata.title;
    upsertMeta('meta[name="description"]', {
      name: "description",
      content: metadata.description,
    });
    upsertMeta('meta[name="robots"]', {
      name: "robots",
      content: "index, follow, max-image-preview:large",
    });
    upsertMeta('meta[property="og:type"]', {
      property: "og:type",
      content: "website",
    });
    upsertMeta('meta[property="og:site_name"]', {
      property: "og:site_name",
      content: SITE_NAME,
    });
    upsertMeta('meta[property="og:title"]', {
      property: "og:title",
      content: metadata.title,
    });
    upsertMeta('meta[property="og:description"]', {
      property: "og:description",
      content: metadata.description,
    });
    upsertMeta('meta[property="og:url"]', {
      property: "og:url",
      content: canonicalUrl,
    });
    upsertMeta('meta[property="og:image"]', {
      property: "og:image",
      content: SITE_LOGO_URL,
    });
    upsertMeta('meta[name="twitter:card"]', {
      name: "twitter:card",
      content: "summary",
    });
    upsertMeta('meta[name="twitter:title"]', {
      name: "twitter:title",
      content: metadata.title,
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: "twitter:description",
      content: metadata.description,
    });
    upsertMeta('meta[name="twitter:image"]', {
      name: "twitter:image",
      content: SITE_LOGO_URL,
    });
    upsertCanonical(canonicalUrl);
    updateStructuredData(pathname, metadata);
  }, [pathname]);

  return null;
}
