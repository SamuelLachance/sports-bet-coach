function normalizeSeparators(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => normalizeSeparators(String(part)))
    .join("/")
    .replace(/\/+/g, "/");
}

export function dirname(filePath: string): string {
  const normalized = normalizeSeparators(filePath);
  const trimmed = normalized.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash <= 0) return lastSlash === 0 ? "/" : ".";
  return trimmed.slice(0, lastSlash);
}

export default { join, dirname };
