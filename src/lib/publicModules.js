const PUBLIC_MODULE_STATUSES = new Set(["available", "coming_soon", "paused"]);

export function normalizePublicModules(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row) => (
      typeof row?.name === "string"
      && row.name.trim()
      && typeof row?.slug === "string"
      && row.slug.trim()
      && PUBLIC_MODULE_STATUSES.has(row.availability_status)
    ))
    .map((row) => ({
      name: row.name.trim(),
      slug: row.slug.trim(),
      practiceType: row.practice_type === "oral" ? "oral" : "objective",
      status: row.availability_status,
    }));
}
