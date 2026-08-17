/**
 * text-extractor.mjs — Extract candidate text from uploads.
 * Never invents content. Empty extraction stays empty.
 */

import zlib from "node:zlib";
import { cleanExtractedText } from "../../profile-parser.mjs";

export function extractDocxText(buffer) {
  if (!Buffer.isBuffer(buffer)) return "";
  try {
    let pos = 0;
    while (pos < buffer.length - 4) {
      if (buffer[pos] === 0x50 && buffer[pos + 1] === 0x4b && buffer[pos + 2] === 0x03 && buffer[pos + 3] === 0x04) {
        const compression = buffer.readUInt16LE(pos + 8);
        const compressedSize = buffer.readUInt32LE(pos + 18);
        const uncompressedSize = buffer.readUInt32LE(pos + 22);
        const filenameLen = buffer.readUInt16LE(pos + 26);
        const extraLen = buffer.readUInt16LE(pos + 28);
        const filename = buffer.toString("utf8", pos + 30, pos + 30 + filenameLen);
        const dataStart = pos + 30 + filenameLen + extraLen;
        if (filename === "word/document.xml") {
          let xml = "";
          if (compression === 0) {
            xml = buffer.toString("utf8", dataStart, dataStart + uncompressedSize);
          } else if (compression === 8) {
            xml = zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize)).toString("utf8");
          }
          return xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n\s*\n/g, "\n").trim();
        }
        pos = dataStart + compressedSize;
      } else {
        pos++;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function decodePdfLiteral(raw) {
  return String(raw || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\(.)/g, "$1");
}

function literalsFromPdf(haystack) {
  const parts = [];
  const bt = /BT[\s\S]*?ET/g;
  let m;
  while ((m = bt.exec(haystack))) {
    const tj = [...m[0].matchAll(/\((?:\\.|[^\\)])*\)/g)].map((x) => decodePdfLiteral(x[0].slice(1, -1)));
    if (tj.length) parts.push(tj.join(" "));
  }
  if (parts.join("").trim().length >= 40) return parts.join("\n").trim();
  const loose = [...haystack.matchAll(/\((?:\\.|[^\\)]){3,}\)/g)].map((x) => decodePdfLiteral(x[0].slice(1, -1)));
  return loose.filter((s) => /[A-Za-z]{3,}/.test(s)).join(" ").trim() || parts.join("\n").trim();
}

function inflatePdfStreams(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  let scanned = 0;
  while ((m = re.exec(raw)) && scanned < 40) {
    scanned += 1;
    const payload = Buffer.from(m[1], "latin1");
    for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
      try {
        const inflated = fn(payload).toString("latin1");
        if (inflated.length > 20 && (/BT[\s\S]{8,}ET/.test(inflated) || /\([A-Za-z]{3,}\)/.test(inflated))) {
          chunks.push(inflated);
        }
        break;
      } catch {
        /* try the other inflater */
      }
    }
  }
  return chunks.join("\n");
}

export function extractPdfText(buffer) {
  if (!Buffer.isBuffer(buffer)) return "";
  const raw = buffer.toString("latin1");
  const fromLiterals = literalsFromPdf(raw);
  if (fromLiterals.length >= 40) return fromLiterals;
  const inflated = inflatePdfStreams(buffer);
  const fromStreams = inflated ? literalsFromPdf(inflated) : "";
  return fromStreams || fromLiterals;
}

/**
 * @param {{ text?: string, buffer?: Buffer, filename?: string, mimeType?: string }} input
 */
export function extractDocumentText(input = {}) {
  const filename = String(input.filename || "").toLowerCase();
  const mime = String(input.mimeType || "").toLowerCase();
  let text = typeof input.text === "string" ? input.text : "";
  const warnings = [];

  if (!text.trim() && Buffer.isBuffer(input.buffer)) {
    if (filename.endsWith(".docx") || mime.includes("wordprocessingml")) {
      text = extractDocxText(input.buffer);
    } else if (filename.endsWith(".pdf") || mime === "application/pdf") {
      text = extractPdfText(input.buffer);
      if (!text.trim()) {
        warnings.push("PDF text extraction found no readable text. Paste the document text instead of uploading a scanned image.");
      }
    } else {
      text = input.buffer.toString("utf-8");
    }
  }

  const cleaned = cleanExtractedText(text);
  return {
    text: cleaned,
    empty: !cleaned,
    warnings,
  };
}
