import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  getCanonicalUrl,
  PUBLIC_PAGE_METADATA,
} from "../../src/lib/seoMetadata.js";

const outputDirectory = path.resolve(process.cwd(), "dist");

function extract(html, pattern, label, filePath) {
  const match = html.match(pattern);
  assert.ok(match, `${filePath} is missing ${label}.`);
  return match[1];
}

for (const [pathname, metadata] of Object.entries(PUBLIC_PAGE_METADATA)) {
  const relativePath = pathname === "/" ? "index.html" : path.join(pathname.slice(1), "index.html");
  const filePath = path.join(outputDirectory, relativePath);
  const html = await readFile(filePath, "utf8");
  const title = extract(html, /<title>(.*?)<\/title>/i, "a title", filePath);
  const canonicalUrl = extract(
    html,
    /<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/i,
    "a canonical URL",
    filePath,
  );
  const schemaSource = extract(
    html,
    /<script\s+id="site-identity-structured-data"\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i,
    "structured data",
    filePath,
  );

  assert.equal(title, metadata.title, `${filePath} has the wrong title.`);
  assert.equal(canonicalUrl, getCanonicalUrl(pathname), `${filePath} has the wrong canonical URL.`);
  assert.doesNotThrow(() => JSON.parse(schemaSource), `${filePath} has invalid JSON-LD.`);
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="index, follow, max-image-preview:large"\s*\/?>/i,
    `${filePath} must be indexable.`,
  );
}

const robots = await readFile(path.join(outputDirectory, "robots.txt"), "utf8");
const sitemap = await readFile(path.join(outputDirectory, "sitemap.xml"), "utf8");

assert.match(robots, /User-agent: OAI-SearchBot\s+Allow: \//);
assert.match(robots, /Sitemap: https:\/\/promotionsure\.com\.ng\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/promotionsure\.com\.ng\/<\/loc>/);

console.log("SEO build outputs are valid.");
