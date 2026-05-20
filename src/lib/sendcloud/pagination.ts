/** RFC 8288 Link header parsing for Sendcloud API v3 cursor pagination. */

export function parseSendcloudLinkHeader(linkHeader: string | null | undefined): {
  next?: string;
  prev?: string;
} {
  const out: { next?: string; prev?: string } = {};
  if (!linkHeader?.trim()) return out;

  for (const part of linkHeader.split(",")) {
    const segment = part.trim();
    const urlMatch = segment.match(/^<([^>]+)>/);
    const relMatch = segment.match(/rel="(next|prev)"/);
    if (!urlMatch || !relMatch) continue;
    if (relMatch[1] === "next") out.next = urlMatch[1];
    if (relMatch[1] === "prev") out.prev = urlMatch[1];
  }

  return out;
}
