export function isCoursierErrorResponse(raw: unknown): raw is { Message: string } {
  return (
    raw != null &&
    typeof raw === "object" &&
    "Message" in raw &&
    typeof (raw as { Message?: unknown }).Message === "string"
  );
}

export async function postCoursierJson(url: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`coursier_http_${res.status}: ${rawText.slice(0, 600)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("coursier_invalid_json");
  }

  if (isCoursierErrorResponse(parsed)) {
    throw new Error(`coursier_api_error: ${parsed.Message}`);
  }

  return parsed;
}
