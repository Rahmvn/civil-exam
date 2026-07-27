export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export class RequestBodyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export function getRequestErrorStatus(error: unknown, fallback = 400) {
  return error instanceof RequestBodyError ? error.status : fallback;
}

export async function readTextBody(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // The size limit is already enforced even if cancellation races.
      }
      throw new RequestBodyError("Request body is too large", 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new RequestBodyError("Request body must be valid UTF-8");
  }
}

export async function readJsonBody(request: Request, maxBytes: number) {
  const body = await readTextBody(request, maxBytes);
  if (!body.trim()) throw new RequestBodyError("Request body is required");

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestBodyError("Request body must be valid JSON");
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function requireEnv(name: string) {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}
