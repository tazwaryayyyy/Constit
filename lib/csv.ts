// lib/csv.ts
// Robust CSV parsing. Real voter data is ugly. This handles it.

import Papa from "papaparse";
import type {
  ParsedRow,
  ErrorRow,
  CSVColumn,
  ParseResult,
  MappingResult,
  ColumnMapping,
} from "@/types/csv";

export type { ParsedRow, ErrorRow, CSVColumn, ParseResult, MappingResult, ColumnMapping };

// ── Phone normalization ───────────────────────────────────────────────────
// Handles: 017xxxxxxxx, +88017xxxxxxxx, 88017xxxxxxxx, (555) 555-5555, etc.
export function normalizePhone(raw: string): {
  normalized: string;
  valid: boolean;
  warning?: string;
} {
  if (!raw || !raw.trim()) return { normalized: "", valid: false, warning: "Empty" };

  const stripped = raw.trim();
  const hasPlus = stripped.startsWith("+");
  const digits = stripped.replace(/\D/g, "");

  if (!digits) return { normalized: "", valid: false, warning: "No digits found" };
  if (digits.length < 7) return { normalized: digits, valid: false, warning: "Too short" };
  if (digits.length > 15) return { normalized: digits, valid: false, warning: "Too long (> 15 digits)" };

  if (hasPlus) {
    return { normalized: "+" + digits, valid: true };
  }
  // US: 10 digits → assume +1
  if (digits.length === 10) {
    return { normalized: "+1" + digits, valid: true };
  }
  // US with country code
  if (digits.length === 11 && digits.startsWith("1")) {
    return { normalized: "+" + digits, valid: true };
  }
  // International without + — store as digits, warn
  return {
    normalized: digits,
    valid: true,
    warning: "No country code detected — stored as digits",
  };
}

function isValidEmail(email: string): boolean {
  if (!email) return true; // email is optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Step 1: Parse CSV and return columns + raw rows ───────────────────────
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

// ── Step 2: Apply user-confirmed mapping → produce clean rows + error rows ─
// Partial success: rows with no name are errors. Invalid phone/email = warn,
// still import (both fields are optional in the schema).
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): MappingResult {
  const valid: ParsedRow[] = [];
  const errors: ErrorRow[] = [];

  rows.forEach((row, rowIndex) => {
    const rowErrors: string[] = [];

    // ── Name ─────────────────────────────────────────────────────
    let name = "";
    if (mapping.fullName) {
      const raw = (row[mapping.fullName] ?? "").trim();
      if (raw.includes(",")) {
        const [last, first] = raw.split(",").map((s) => s.trim());
        name = `${first} ${last}`.trim();
      } else {
        name = raw;
      }
    } else if (mapping.firstName || mapping.lastName) {
      const first = mapping.firstName ? (row[mapping.firstName] ?? "").trim() : "";
      const last = mapping.lastName ? (row[mapping.lastName] ?? "").trim() : "";
      name = `${first} ${last}`.trim();
    }

    if (!name) {
      rowErrors.push("Missing name — row skipped");
    }

    // ── Phone ─────────────────────────────────────────────────────
    // Hard gate: if a phone column is mapped, every row MUST have a valid phone.
    // An SMS campaign with no phone number is a dead record — reject, don't silently pass.
    const rawPhone = mapping.phone ? (row[mapping.phone] ?? "").trim() : "";
    let normalizedPhone = "";
    if (mapping.phone) {
      if (!rawPhone) {
        rowErrors.push("Missing phone — row rejected (phone column is mapped but value is empty)");
      } else {
        const result = normalizePhone(rawPhone);
        if (!result.valid) {
          rowErrors.push(`Invalid phone "${rawPhone}": ${result.warning} — row rejected`);
          // normalizedPhone stays "" — row will be flagged as error below
        } else {
          normalizedPhone = result.normalized;
          if (result.warning) {
            rowErrors.push(`Phone note: ${result.warning}`);
          }
        }
      }
    }

    // ── Email ─────────────────────────────────────────────────────
    const email = mapping.email ? (row[mapping.email] ?? "").trim().toLowerCase() : "";
    if (email && !isValidEmail(email)) {
      rowErrors.push(`Invalid email "${email}"`);
    }

    // ── Tags ──────────────────────────────────────────────────────
    const rawTags = mapping.tags ? (row[mapping.tags] ?? "") : "";
    const tags = rawTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const notes = mapping.notes ? (row[mapping.notes] ?? "").trim() : "";

    // Rows with no name cannot be imported
    if (!name) {
      errors.push({ rowIndex, rawName: "", rawPhone, errors: rowErrors });
      return;
    }

    // Rows with no/invalid phone are also rejected when phone column is mapped.
    // Detect this by checking if mapping.phone is set but normalizedPhone is still empty.
    const hasPhoneError = mapping.phone && !normalizedPhone;
    if (hasPhoneError) {
      errors.push({ rowIndex, rawName: name, rawPhone, errors: rowErrors });
      return;
    }

    // Rows with only non-fatal warnings (e.g. email format, phone country code note) are imported
    if (rowErrors.length > 0) {
      errors.push({ rowIndex, rawName: name, rawPhone, errors: rowErrors });
    }

    valid.push({
      name,
      phone: normalizedPhone,
      email: isValidEmail(email) ? email : "",
      tags,
      notes,
    });
  });

  return { valid, errors };
}

// ── Auto-detect column mapping (best-effort, user must confirm) ───────────
export function autoDetectMapping(columns: CSVColumn[]): ColumnMapping {
  const find = (...candidates: string[]): string | null => {
    for (const candidate of candidates) {
      const match = columns.find((c) =>
        c.key.toLowerCase().includes(candidate.toLowerCase())
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
    phone: find("phone", "mobile", "cell", "telephone"),
    email: find("email", "e-mail", "mail"),
    tags: find("tags", "label", "category", "group", "district", "ward"),
    notes: find("notes", "comments", "remarks"),
  };
}
