import { parse } from "csv-parse/sync";
import type { ArchiveEntry } from "../types.js";

export function parseArchiveCsv(csv: string): ArchiveEntry[] {
  const rows: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: true });
  const entries: ArchiveEntry[] = [];

  for (const row of rows) {
    const date = (row[0] || "").trim();
    const link = (row[1] || row[0] || "").trim();
    if (!date || date.toLowerCase() === "date" || date.toLowerCase() === "archive") continue;
    entries.push({ date, label: link });
  }

  return entries;
}
