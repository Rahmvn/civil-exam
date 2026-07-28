import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getCanonicalUrl,
  getHomeStructuredData,
  getPublicPageMetadata,
  PUBLIC_PAGE_METADATA,
} from "../../src/lib/seoMetadata.js";

const projectFile = (relativePath) => new URL(`../../${relativePath}`, import.meta.url);

test("public SEO metadata uses one canonical PromotionSure origin", () => {
  assert.equal(getCanonicalUrl("/"), "https://promotionsure.com.ng/");
  assert.equal(getCanonicalUrl("/privacy/"), "https://promotionsure.com.ng/privacy");
  assert.equal(getPublicPageMetadata("/support")?.title, "Support | PromotionSure");
  assert.equal(getPublicPageMetadata("/dashboard"), null);
  assert.deepEqual(
    Object.keys(PUBLIC_PAGE_METADATA),
    ["/", "/privacy", "/terms", "/support"],
  );
});

test("homepage structured data identifies the site and online business", () => {
  const structuredData = getHomeStructuredData();
  const website = structuredData["@graph"].find((entry) => entry["@type"] === "WebSite");
  const organization = structuredData["@graph"].find(
    (entry) => entry["@type"] === "OnlineBusiness",
  );

  assert.equal(website.name, "PromotionSure");
  assert.equal(website.url, "https://promotionsure.com.ng/");
  assert.equal(organization.name, "PromotionSure");
  assert.equal(organization.areaServed.name, "Nigeria");
  assert.equal(organization.founder.name, "Muraina Rasheedah");
  assert.doesNotMatch(JSON.stringify(structuredData), /sameAs/);
});

test("robots policy allows search discovery and separates training crawlers", async () => {
  const robots = await readFile(projectFile("public/robots.txt"), "utf8");

  assert.match(robots, /User-agent: OAI-SearchBot\s+Allow: \//);
  assert.match(robots, /User-agent: PerplexityBot\s+Allow: \//);
  assert.match(robots, /User-agent: Claude-SearchBot\s+Allow: \//);
  assert.match(robots, /User-agent: GPTBot\s+Disallow: \//);
  assert.match(robots, /User-agent: ClaudeBot\s+Disallow: \//);
  assert.match(robots, /Sitemap: https:\/\/promotionsure\.com\.ng\/sitemap\.xml/);
});

test("sitemap contains only intentional public routes", async () => {
  const sitemap = await readFile(projectFile("public/sitemap.xml"), "utf8");

  for (const pathname of Object.keys(PUBLIC_PAGE_METADATA)) {
    assert.match(sitemap, new RegExp(getCanonicalUrl(pathname).replaceAll("/", "\\/")));
  }

  assert.doesNotMatch(sitemap, /\/auth|\/dashboard|\/practice|\/admin|\/help/);
});

test("source homepage exposes canonical metadata and entity data without JavaScript", async () => {
  const html = await readFile(projectFile("index.html"), "utf8");

  assert.match(html, /rel="canonical" href="https:\/\/promotionsure\.com\.ng\/"/);
  assert.match(html, /name="robots" content="index, follow, max-image-preview:large"/);
  assert.match(html, /property="og:url" content="https:\/\/promotionsure\.com\.ng\/"/);
  assert.match(html, /"@type": "WebSite"/);
  assert.match(html, /"@type": "OnlineBusiness"/);
});

test("deployment serves explicit public snapshots and does not rewrite unknown URLs", async () => {
  const config = JSON.parse(await readFile(projectFile("vercel.json"), "utf8"));
  const rewrites = config.rewrites.map(({ source, destination }) => ({ source, destination }));
  const noindexSources = config.headers
    .filter(({ headers }) => headers.some(({ key }) => key === "X-Robots-Tag"))
    .map(({ source }) => source);

  assert.deepEqual(
    rewrites.slice(0, 3),
    [
      { source: "/privacy", destination: "/privacy/index.html" },
      { source: "/terms", destination: "/terms/index.html" },
      { source: "/support", destination: "/support/index.html" },
    ],
  );
  assert.equal(rewrites.some(({ source }) => source === "/(.*)"), false);
  assert.ok(noindexSources.includes("/auth/:path*"));
  assert.ok(noindexSources.includes("/practice/:path*"));
  assert.ok(noindexSources.includes("/admin/:path*"));
});
