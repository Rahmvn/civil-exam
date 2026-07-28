import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCanonicalUrl,
  getPublicPageStructuredData,
  PUBLIC_PAGE_METADATA,
  SITE_LOGO_URL,
  SITE_NAME,
} from "../src/lib/seoMetadata.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(projectRoot, "dist");
const builtIndexPath = path.join(outputDirectory, "index.html");

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceRequired(html, pattern, replacement, label) {
  if (!pattern.test(html)) {
    throw new Error(`Could not generate SEO page: missing ${label} in built index.html.`);
  }

  return html.replace(pattern, replacement);
}

function replaceMeta(html, attribute, key, content) {
  const pattern = new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`, "i");
  const replacement = `<meta ${attribute}="${key}" content="${escapeHtmlAttribute(content)}" />`;
  return replaceRequired(html, pattern, replacement, `${attribute}="${key}" metadata`);
}

function buildRouteHtml(baseHtml, pathname, metadata) {
  const canonicalUrl = getCanonicalUrl(pathname);
  const structuredData = JSON.stringify(
    getPublicPageStructuredData(pathname, metadata),
  ).replaceAll("<", "\\u003c");

  let html = replaceRequired(
    baseHtml,
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtmlAttribute(metadata.title)}</title>`,
    "title",
  );

  html = replaceMeta(html, "name", "description", metadata.description);
  html = replaceMeta(html, "name", "robots", "index, follow, max-image-preview:large");
  html = replaceMeta(html, "property", "og:type", "website");
  html = replaceMeta(html, "property", "og:site_name", SITE_NAME);
  html = replaceMeta(html, "property", "og:title", metadata.title);
  html = replaceMeta(html, "property", "og:description", metadata.description);
  html = replaceMeta(html, "property", "og:url", canonicalUrl);
  html = replaceMeta(html, "property", "og:image", SITE_LOGO_URL);
  html = replaceMeta(html, "name", "twitter:card", "summary");
  html = replaceMeta(html, "name", "twitter:title", metadata.title);
  html = replaceMeta(html, "name", "twitter:description", metadata.description);
  html = replaceMeta(html, "name", "twitter:image", SITE_LOGO_URL);
  html = replaceRequired(
    html,
    /<link\s+rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}" />`,
    "canonical link",
  );
  html = replaceRequired(
    html,
    /<script\s+id="site-identity-structured-data"\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script id="site-identity-structured-data" type="application/ld+json">${structuredData}</script>`,
    "structured data",
  );

  return html;
}

const baseHtml = await readFile(builtIndexPath, "utf8");

for (const [pathname, metadata] of Object.entries(PUBLIC_PAGE_METADATA)) {
  if (pathname === "/") continue;

  const routeDirectory = path.join(outputDirectory, pathname.slice(1));
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(
    path.join(routeDirectory, "index.html"),
    buildRouteHtml(baseHtml, pathname, metadata),
    "utf8",
  );
}

console.log(`Generated ${Object.keys(PUBLIC_PAGE_METADATA).length - 1} public SEO route pages.`);
