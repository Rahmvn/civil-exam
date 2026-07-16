function readEnv(name) {
  return globalThis.Deno?.env?.get(name) ?? "";
}

function parseKeyDictionary(rawValue, envName) {
  if (!rawValue) return null;

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`${envName} must be valid JSON`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${envName} must be a JSON object`);
  }

  const defaultKey = parsed.default;
  if (typeof defaultKey !== "string" || !defaultKey.trim()) {
    throw new Error(`${envName}.default is not configured`);
  }

  return defaultKey.trim();
}

export function resolveSupabaseKey({ dictionaryEnvName, legacyEnvName, label }, getEnv = readEnv) {
  const dictionaryKey = parseKeyDictionary(getEnv(dictionaryEnvName), dictionaryEnvName);
  if (dictionaryKey) return dictionaryKey;

  const legacyKey = getEnv(legacyEnvName);
  if (typeof legacyKey === "string" && legacyKey.trim()) return legacyKey.trim();

  throw new Error(`${label} is not configured`);
}
