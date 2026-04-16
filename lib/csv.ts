// lib/csv.ts
// Robust CSV parsing. Real voter data is ugly. This handles it.

import Papa from "papaparse";

export interface ParsedRow {
  name: string;
  phone: string;
  email: string;
  tags: string[];
  notes: string;
}

export interface CSVColumn {
  key: string;       // raw column header from the file
  sample: string[];  // first 3 non-empty values for the user to see
}

export interface ParseResult {
  columns: CSVColumn[];
  rows: Record<string, string>[];
  totalRows: number;
  errors: string[];
}

// Step 1: Parse CSV and return columns + raw rows for the mapping UI
export function parseCSVForMapping(csvString: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const errors: string[] = [];
  if (result.errors.length > 0) {
    errors.push(...result.errors.slice(0, 5).map((e) => e.message));
  }

  const columns: CSVColumn[] = (result.meta.fields ?? []).map((key) => ({
    key,
    sample: result.data
      .map((row) => row[key])
      .filter(Boolean)
      .slice(0, 3),
  }));

  return {
    columns,
    rows: result.data,
    totalRows: result.data.length,
    errors,
  };
}

export interface ColumnMapping {
  firstName: string | null;   // column key for first name
  lastName: string | null;    // column key for last name (separate column)
  fullName: string | null;    // OR a combined name column
  phone: string | null;
  email: string | null;
  tags: string | null;        // comma-separated tags column
  notes: string | null;
}

// Step 2: Apply user-defined column mapping to produce clean contact rows
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): ParsedRow[] {
  return rows.map((row) => {
    // ── CRITICAL FIX #2: Handle name in multiple formats ──────────────────

    let name = "";

    if (mapping.fullName) {
      // Full name column — handle "Smith, John" (last, first) format
      const raw = (row[mapping.fullName] ?? "").trim();
      if (raw.includes(",")) {
        const [last, first] = raw.split(",").map((s) => s.trim());
        name = `${first} ${last}`.trim();
      } else {
        name = raw;
      }
    } else if (mapping.firstName || mapping.lastName) {
      // Separate first/last columns
      const first = mapping.firstName ? (row[mapping.firstName] ?? "").trim() : "";
      const last = mapping.lastName ? (row[mapping.lastName] ?? "").trim() : "";
      name = `${first} ${last}`.trim();
    }

    // Clean phone: strip anything that isn't digits, +, -, (, ), space
    const rawPhone = mapping.phone ? (row[mapping.phone] ?? "").trim() : "";
    const phone = rawPhone.replace(/[^\d+\-() ]/g, "");

    const email = mapping.email ? (row[mapping.email] ?? "").trim().toLowerCase() : "";

    // Tags: split by comma, strip whitespace, filter empty
    const rawTags = mapping.tags ? (row[mapping.tags] ?? "") : "";
    const tags = rawTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const notes = mapping.notes ? (row[mapping.notes] ?? "").trim() : "";

    return { name, phone, email, tags, notes };
  }).filter((row) => row.name.length > 0); // drop rows with no name
}

// Auto-detect column mapping from common header names (best-effort, user confirms)
export function autoDetectMapping(columns: CSVColumn[]): ColumnMapping {
  const keys = columns.map((c) => c.key.toLowerCase());

  const find = (...candidates: string[]): string | null => {
    for (const candidate of candidates) {
      const match = columns.find(
        (c) => c.key.toLowerCase().includes(candidate)
      );
      if (match) return match.key;
    }
    return null;
  };

  const hasFirstAndLast =
    find("first name", "first_name", "firstname") !== null &&
    find("last name", "last_name", "lastname") !== null;

  return {
    fullName: hasFirstAndLast ? null : find("full name", "fullname", "name", "voter name"),
    firstName: find("first name", "first_name", "firstname", "given name"),
    lastName: find("last name", "last_name", "lastname", "surname", "family name"),
    phone: find("phone", "mobile", "cell", "telephone", "contact"),
    email: find("email", "e-mail", "mail"),
    tags: find("tags", "label", "category", "group", "district", "ward"),
    notes: find("notes", "comments", "remarks"),
  };
}
