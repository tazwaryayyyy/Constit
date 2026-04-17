// types/csv.ts
// Types for the CSV import/export pipeline. Single source of truth.
// lib/csv.ts imports from here — nothing else declares these.

export interface ParsedRow {
    name: string;
    phone: string;   // normalized phone (E.164 where detectable)
    email: string;
    tags: string[];
    notes: string;
}

export interface ErrorRow {
    rowIndex: number;
    rawName: string;
    rawPhone: string;
    errors: string[];
}

export interface CSVColumn {
    key: string;
    sample: string[];  // first 3 non-empty values for the user to see
}

export interface ParseResult {
    columns: CSVColumn[];
    rows: Record<string, string>[];
    totalRows: number;
    errors: string[];
}

export interface MappingResult {
    valid: ParsedRow[];
    errors: ErrorRow[];
}

export interface ColumnMapping {
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;
    phone: string | null;
    email: string | null;
    tags: string | null;
    notes: string | null;
}
