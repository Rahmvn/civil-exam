export function formatServiceLevelLabel(value) {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  const normalized = raw.replace(/\s+/g, " ");
  const glMatch = normalized.match(/^gl\s*0*([0-9]+)$/i);

  if (glMatch) {
    return `GL ${Number(glMatch[1])}`;
  }

  if (/^\d+$/.test(normalized)) {
    return `GL ${Number(normalized)}`;
  }

  return normalized;
}
