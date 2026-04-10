/**
 * Remplace next/font/google (Montserrat, Playfair_Display) par segna-webfonts.
 * Usage: node scripts/replace-next-font-google.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

function skipAfterClosingBrace(content, openBraceIdx) {
  let i = openBraceIdx;
  if (content[i] !== "{") throw new Error("expected {");
  let depth = 0;
  for (; i < content.length; i += 1) {
    const c = content[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  let j = i;
  while (j < content.length && /\s/.test(content[j])) j += 1;
  if (content[j] !== ")" || content[j + 1] !== ";") {
    throw new Error(`expected ); after font config at ${j}: ${JSON.stringify(content.slice(j, j + 30))}`);
  }
  return j + 2;
}

function transformFile(relPath) {
  const filePath = path.join(ROOT, relPath);
  let s = fs.readFileSync(filePath, "utf8");
  const orig = s;

  const montserratVars = new Set();
  const playfairVars = new Set();

  const declRe = /(^|\n)(export )?const (\w+) = (Montserrat|Playfair_Display)\(\{/g;
  let m;
  while ((m = declRe.exec(s)) !== null) {
    const exportKw = m[2] || "";
    const name = m[3];
    const kind = m[4];
    if (exportKw) {
      console.warn(`${relPath}: skip exported font const ${name} (edit manually)`);
      continue;
    }
    const objStart = m.index + m[0].length - 1;
    const after = skipAfterClosingBrace(s, objStart);
    const cutStart = m[1] === "\n" ? m.index + 1 : m.index;
    s = s.slice(0, cutStart) + s.slice(after);
    declRe.lastIndex = cutStart;
    if (kind === "Montserrat") montserratVars.add(name);
    else playfairVars.add(name);
  }

  s = s.replace(/^import \{[^}]*\} from "next\/font\/google";\s*\n?/gm, (line) => {
    if (/Geist/.test(line)) return line;
    return "";
  });

  const needsMontserrat = montserratVars.size > 0;
  const needsPlayfair = playfairVars.size > 0;
  if (!needsMontserrat && !needsPlayfair) {
    return false;
  }

  const im = [];
  if (needsMontserrat) im.push("segnaMontserrat");
  if (needsPlayfair) im.push("segnaPlayfairDisplay");
  const importLine = `import { ${im.join(", ")} } from "@/lib/ui/segna-webfonts";\n`;

  const aliasLines = [];
  for (const n of montserratVars) aliasLines.push(`const ${n} = segnaMontserrat;`);
  for (const n of playfairVars) aliasLines.push(`const ${n} = segnaPlayfairDisplay;`);
  const block = `${importLine}${aliasLines.join("\n")}\n`;

  const lines = s.split("\n");
  let j = 0;
  while (j < lines.length && (/^"use client"/.test(lines[j]) || /^\s*$/.test(lines[j]))) {
    j += 1;
  }
  while (j < lines.length && /^import\s/.test(lines[j])) {
    j += 1;
  }
  const insertAt = lines.slice(0, j).join("\n").length + (j > 0 ? 1 : 0);
  s = s.slice(0, insertAt) + block + s.slice(insertAt);

  fs.writeFileSync(filePath, s);
  return true;
}

const files = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "next-font-files.json"), "utf8"),
);
let n = 0;
for (const f of files) {
  if (transformFile(f)) n += 1;
}
console.log(`Updated ${n} files`);
