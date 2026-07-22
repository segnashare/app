/**
 * Rendu description pièce : Markdown léger (titres, listes, gras/italique)
 * ou HTML déjà allégé. Sortie HTML échappée hors balises autorisées.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function looksLikeHtml(raw: string): boolean {
  return /<\/?(h[1-3]|p|ul|ol|li|strong|em|b|i|br)\b/i.test(raw);
}

function sanitizeItemDescriptionHtml(html: string): string {
  // Strip scripts/styles and strip event handlers; keep a small allowlist via regex rebuild.
  let s = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

  // Remove disallowed tags but keep their text content.
  s = s.replace(/<\/?(?!\/?(?:h[1-3]|p|ul|ol|li|strong|em|b|i|br)\b)[a-z][^>]*>/gi, "");
  // Drop attributes on allowed tags except nothing (strip all attrs).
  s = s.replace(/<(h[1-3]|p|ul|ol|li|strong|em|b|i)(\s[^>]*)?>/gi, "<$1>");
  s = s.replace(/<br\s*\/?>/gi, "<br />");
  return s;
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inUl = false;
  let inOl = false;

  const flushLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  const inline = (text: string): string => {
    let t = escapeHtml(text);
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/__(.+?)__/g, "<strong>$1</strong>");
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    t = t.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");
    return t;
  };

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    const ul = line.match(/^[-*]\s+(.+)$/);
    const ol = line.match(/^\d+\.\s+(.+)$/);

    if (h1 || h2 || h3) {
      flushLists();
      const tag = h1 ? "h1" : h2 ? "h2" : "h3";
      const body = (h1 ?? h2 ?? h3)![1];
      html.push(`<${tag}>${inline(body)}</${tag}>`);
      continue;
    }
    if (ul) {
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    if (ol) {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      flushLists();
      continue;
    }
    flushLists();
    html.push(`<p>${inline(line)}</p>`);
  }
  flushLists();
  return html.join("");
}

/** Convertit description stockée → HTML sûr pour affichage. */
export function itemDescriptionToSafeHtml(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  if (looksLikeHtml(text)) return sanitizeItemDescriptionHtml(text);
  return markdownToHtml(text);
}

/** Convertit un fragment HTML collé (Word / Docs) en Markdown léger. */
export function htmlFragmentToMarkdown(html: string): string {
  const doc = typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(html, "text/html") : null;
  if (!doc) return html;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(walk).join("");
    if (tag === "h1") return `# ${children.trim()}\n\n`;
    if (tag === "h2") return `## ${children.trim()}\n\n`;
    if (tag === "h3") return `### ${children.trim()}\n\n`;
    if (tag === "li") return children.trim();
    if (tag === "ul") {
      return (
        Array.from(el.children)
          .map((c) => `- ${walk(c).trim()}`)
          .join("\n") + "\n\n"
      );
    }
    if (tag === "ol") {
      return (
        Array.from(el.children)
          .map((c, i) => `${i + 1}. ${walk(c).trim()}`)
          .join("\n") + "\n\n"
      );
    }
    if (tag === "p" || tag === "div") return `${children.trim()}\n\n`;
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${children}**`;
    if (tag === "em" || tag === "i") return `*${children}*`;
    return children;
  };

  return walk(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}
