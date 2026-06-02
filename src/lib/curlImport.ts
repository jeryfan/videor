import { toast } from "sonner";

export type InputFormat = "curl" | "keyValue";

export interface ParsedHeadersResult {
  domain: string;
  url: string;
  rawCurl: string;
  headerCount: number;
}

export interface CurlImportEntry {
  domain: string;
  rawCurl: string;
  headerCount: number;
}

export interface ExtractedHeader {
  name: string;
  value: string;
}

const CURL_IMPORTS_STORAGE_KEY = "videor-curl-imports";
const CURL_FILL_URL_KEY = "videor-curl-fill-url";

const BLOCKED_HEADERS = new Set([
  "host",
  "authority",
  "method",
  "path",
  "scheme",
  "content-length",
  "connection",
  "transfer-encoding",
  "accept-encoding",
  "upgrade",
  "proxy-connection",
]);

export function extractUrlFromCurl(rawCurl: string): string | null {
  const trimmed = rawCurl.trim();
  if (!trimmed.startsWith("curl ")) return null;

  const urlFlag = trimmed.match(/(?:^|\s)--url\s+(['"])(https?:\/\/.*?)\1/s);
  if (urlFlag?.[2]) return urlFlag[2];

  const quotedUrl = trimmed.match(/(?:^|\s)(['"])(https?:\/\/.*?)\1/s);
  if (quotedUrl?.[2]) return quotedUrl[2];

  const bareUrl = trimmed.match(/(?:^|\s)(https?:\/\/[^\s'"\\]+)/);
  return bareUrl?.[1] ?? null;
}

export function extractCurlHeaders(rawCurl: string): ExtractedHeader[] {
  if (!rawCurl.trim().startsWith("curl ")) return [];

  return Array.from(
    rawCurl.matchAll(/(?:^|\s)(?:-H|--header)\s+(['"])(.*?)\1/gs),
  )
    .map((match) => {
      const header = match[2];
      const separator = header.indexOf(":");
      if (separator <= 0) return null;
      const name = header.slice(0, separator).trim();
      const value = header.slice(separator + 1).trim();
      if (!name || !value || BLOCKED_HEADERS.has(name.toLowerCase())) {
        return null;
      }
      return { name, value };
    })
    .filter((h): h is ExtractedHeader => h !== null);
}

export function countUsableCurlHeaders(rawCurl: string): number {
  return extractCurlHeaders(rawCurl).length;
}

export function extractDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function getMatchedCurlEntry(
  url: string,
  curlImports: CurlImportEntry[],
): CurlImportEntry | undefined {
  const domain = extractDomainFromUrl(url);
  if (!domain) return undefined;

  const exact = curlImports.find((e) => e.domain === domain);
  if (exact) return exact;

  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join(".");
    const parent = curlImports.find((e) => e.domain === parentDomain);
    if (parent) return parent;
  }

  return undefined;
}

export function loadCurlImports(): CurlImportEntry[] {
  try {
    const raw = localStorage.getItem(CURL_IMPORTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CurlImportEntry =>
        item &&
        typeof item === "object" &&
        typeof item.domain === "string" &&
        typeof item.rawCurl === "string" &&
        typeof item.headerCount === "number",
    );
  } catch {
    return [];
  }
}

export function saveCurlImports(imports: CurlImportEntry[]): void {
  try {
    localStorage.setItem(CURL_IMPORTS_STORAGE_KEY, JSON.stringify(imports));
  } catch {
    // ignore storage errors
  }
}

export function loadCurlFillUrlSetting(): boolean {
  try {
    return localStorage.getItem(CURL_FILL_URL_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveCurlFillUrlSetting(value: boolean): void {
  try {
    localStorage.setItem(CURL_FILL_URL_KEY, String(value));
  } catch {
    // ignore
  }
}

export function detectInputFormat(text: string): InputFormat {
  const trimmed = text.trim();
  if (trimmed.startsWith("curl ")) return "curl";
  return "keyValue";
}

function splitKeyValueLine(line: string): { name: string; value: string } | null {
  const colonIdx = line.indexOf(":");
  const equalIdx = line.indexOf("=");

  let sepIdx: number;
  if (colonIdx === -1 && equalIdx === -1) return null;
  if (colonIdx === -1) sepIdx = equalIdx;
  else if (equalIdx === -1) sepIdx = colonIdx;
  else sepIdx = Math.min(colonIdx, equalIdx);

  const name = line.slice(0, sepIdx).trim();
  const value = line.slice(sepIdx + 1).trim();
  if (!name || !value || BLOCKED_HEADERS.has(name.toLowerCase())) {
    return null;
  }
  return { name, value };
}

export function extractKeyValueHeaders(text: string): ExtractedHeader[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(":") || line.includes("="))
    .map((line) => splitKeyValueLine(line))
    .filter((h): h is ExtractedHeader => h !== null);
}

export function countKeyValueHeaders(text: string): number {
  return extractKeyValueHeaders(text).length;
}

export function buildCurlFromHeaders(text: string, url: string): string {
  const headers = extractKeyValueHeaders(text);
  const headerArgs = headers
    .map((h) => `  -H '${h.name}: ${h.value}'`)
    .join(" \\\n");
  return `curl '${url}'${headerArgs ? " \\\n" + headerArgs : ""}`;
}

export function parseHeadersInput(
  text: string,
  format: InputFormat,
): ParsedHeadersResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (format === "curl") {
    const url = extractUrlFromCurl(trimmed);
    if (!url) return null;
    const domain = extractDomainFromUrl(url);
    if (!domain) return null;
    const headerCount = countUsableCurlHeaders(trimmed);
    return { domain, url, rawCurl: trimmed, headerCount };
  }

  const headerCount = countKeyValueHeaders(trimmed);
  return {
    domain: "",
    url: "",
    rawCurl: trimmed,
    headerCount,
  };
}

export function importCurlEntry(
  curlInputText: string,
  curlInputFormat: InputFormat,
  downloadUrl: string,
  curlImports: CurlImportEntry[],
): {
  success: boolean;
  imports: CurlImportEntry[];
  filledUrl?: string;
  domain?: string;
  headerCount?: number;
  isUpdate?: boolean;
} {
  const detectedFormat = detectInputFormat(curlInputText);
  const format =
    curlInputFormat === "curl" && detectedFormat !== "curl"
      ? detectedFormat
      : curlInputFormat;

  const result = parseHeadersInput(curlInputText, format);
  if (!result) {
    toast.error("无法解析输入内容");
    return { success: false, imports: curlImports };
  }
  if (result.headerCount === 0) {
    toast.error("未提取到有效的 headers");
    return { success: false, imports: curlImports };
  }

  let domain = result.domain;
  let rawCurl = result.rawCurl;

  if (format === "keyValue") {
    const url = downloadUrl.trim();
    if (!url) {
      toast.error("键值对格式需要先在输入框填入 URL");
      return { success: false, imports: curlImports };
    }
    domain = extractDomainFromUrl(url) ?? "";
    if (!domain) {
      toast.error("无法从输入框的 URL 中提取域名");
      return { success: false, imports: curlImports };
    }
    rawCurl = buildCurlFromHeaders(curlInputText, url);
  }

  if (!domain) {
    toast.error("无法提取域名");
    return { success: false, imports: curlImports };
  }

  const isUpdate = curlImports.some((e) => e.domain === domain);
  const filtered = curlImports.filter((e) => e.domain !== domain);
  const nextImports = [
    ...filtered,
    { domain, rawCurl, headerCount: result.headerCount },
  ];

  return {
    success: true,
    imports: nextImports,
    filledUrl: result.url,
    domain,
    headerCount: result.headerCount,
    isUpdate,
  };
}
