"use client";
// components/CSVImporter.tsx
// 4-step flow: Upload → Mapping → Preview (with error rows) → Summary
// Partial success: valid rows are imported, broken rows are downloadable as CSV.

import { useState, useRef } from "react";
import { parseCSVForMapping, autoDetectMapping, CSVColumn, ColumnMapping, ErrorRow } from "@/lib/csv";

interface Props {
  campaignId: string;
  onImported: (count: number) => void;
}

type Step = "upload" | "mapping" | "importing" | "summary";

type MappingField = keyof ColumnMapping;

const MAPPING_FIELDS: { key: MappingField; label: string; description: string }[] = [
  { key: "fullName", label: "Full name column", description: "e.g. 'Name', 'Voter Name', 'Full Name'" },
  { key: "firstName", label: "First name column", description: "e.g. 'First Name', 'Given Name'" },
  { key: "lastName", label: "Last name column", description: "e.g. 'Last Name', 'Surname'" },
  { key: "phone", label: "Phone column", description: "e.g. 'Phone', 'Mobile', 'Cell'" },
  { key: "email", label: "Email column", description: "e.g. 'Email', 'E-mail'" },
  { key: "tags", label: "Tags column", description: "Comma-separated tags in one column" },
  { key: "notes", label: "Notes column", description: "Any extra notes or comments" },
];

function downloadErrorsCSV(errors: ErrorRow[]) {
  const headers = ["row", "name", "phone", "errors"];
  const rows = errors.map((e) => [
    String(e.rowIndex + 2), // +2 because row 1 = header, rows are 0-indexed
    `"${e.rawName}"`,
    `"${e.rawPhone}"`,
    `"${e.errors.join("; ")}"`,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "constit-import-errors.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function CSVImporter({ campaignId, onImported }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [columns, setColumns] = useState<CSVColumn[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    fullName: null, firstName: null, lastName: null,
    phone: null, email: null, tags: null, notes: null,
  });
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "keep_both">("skip");
  const [validationError, setValidationError] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [summary, setSummary] = useState<{
    imported: number;
    skipped: number;
    duplicateCount: number;
    errors: ErrorRow[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSVForMapping(text);
      setColumns(result.columns);
      setRawRows(result.rows);
      setParseErrors(result.errors);
      setMapping(autoDetectMapping(result.columns));
      setStep("mapping");
    };
    reader.readAsText(file);
  }

  function validateMapping(): boolean {
    const hasName = mapping.fullName || mapping.firstName || mapping.lastName;
    if (!hasName) {
      setValidationError("Map at least one name column (Full Name, or First + Last Name).");
      return false;
    }
    setValidationError("");
    return true;
  }

  async function handleImport() {
    if (!validateMapping()) return;
    setStep("importing");

    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId, rows: rawRows, mapping, duplicate_strategy: duplicateStrategy }),
    });

    const data = await res.json();

    if (!res.ok) {
      setValidationError(data.error);
      setStep("mapping");
      return;
    }

    setSummary({ imported: data.imported, skipped: data.skipped, duplicateCount: data.duplicateCount ?? 0, errors: data.errors ?? [] });
    setStep("summary");
    onImported(data.imported);
  }

  const colOptions = [
    <option key="" value="">— not in my file —</option>,
    ...columns.map((c) => (
      <option key={c.key} value={c.key}>
        {c.key} {c.sample.length > 0 ? `(e.g. "${c.sample[0]}")` : ""}
      </option>
    )),
  ];

  // ── Upload step ──────────────────────────────────────────────────────────
  if (step === "upload") return (
    <div className="border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center">
      <p className="text-sm text-zinc-500 mb-4">
        Upload a CSV export of your contact list.<br />
        Any column format works — you&apos;ll map them in the next step.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt"
        onChange={handleFile}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="px-5 py-2.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 transition-colors"
      >
        Choose file
      </button>
      {parseErrors.length > 0 && (
        <p className="text-xs text-red-500 mt-3">Parse warning: {parseErrors[0]}</p>
      )}
    </div>
  );

  // ── Mapping step ─────────────────────────────────────────────────────────
  if (step === "mapping") return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        Detected <strong>{rawRows.length}</strong> rows and <strong>{columns.length}</strong> columns.
        Verify the mapping below — we&apos;ve made our best guess.
      </div>

      <div className="space-y-4">
        {MAPPING_FIELDS.map((field) => {
          const col = columns.find((c) => c.key === (mapping[field.key] ?? ""));
          return (
            <div key={field.key} className="grid grid-cols-2 gap-4 items-start">
              <div>
                <label className="text-sm font-medium text-zinc-800 block">{field.label}</label>
                <p className="text-xs text-zinc-400 mt-0.5">{field.description}</p>
              </div>
              <div>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [field.key]: e.target.value || null }))
                  }
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
                >
                  {colOptions}
                </select>
                {col?.sample.length ? (
                  <p className="text-xs text-zinc-400 mt-1">
                    Samples: {col.sample.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {validationError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {validationError}
        </p>
      )}

      {/* Duplicate handling strategy */}
      <div className="border border-zinc-200 rounded-lg px-4 py-3 space-y-2">
        <p className="text-sm font-medium text-zinc-800">If a phone number already exists in this campaign:</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup_strategy"
              value="skip"
              checked={duplicateStrategy === "skip"}
              onChange={() => setDuplicateStrategy("skip")}
              className="mt-0.5 accent-zinc-900"
            />
            <div>
              <span className="text-sm text-zinc-700 font-medium">Keep existing record, skip new</span>
              <p className="text-xs text-zinc-400">The contact already in the campaign is preserved. The new row is ignored. Recommended.</p>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup_strategy"
              value="keep_both"
              checked={duplicateStrategy === "keep_both"}
              onChange={() => setDuplicateStrategy("keep_both")}
              className="mt-0.5 accent-zinc-900"
            />
            <div>
              <span className="text-sm text-zinc-700 font-medium">Import both records</span>
              <p className="text-xs text-zinc-400">Both rows are added. You may end up with the same number listed twice.</p>
            </div>
          </label>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setStep("upload")}
          className="px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50"
        >
          Back
        </button>
        <button
          onClick={handleImport}
          className="px-5 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700"
        >
          Import {rawRows.length} contacts
        </button>
      </div>
    </div>
  );

  // ── Importing state ──────────────────────────────────────────────────────
  if (step === "importing") return (
    <div className="text-center py-10">
      <div className="inline-block w-5 h-5 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin mb-3" />
      <p className="text-sm text-zinc-500">Importing contacts…</p>
    </div>
  );

  // ── Summary step ─────────────────────────────────────────────────────────
  if (step === "summary" && summary) return (
    <div className="space-y-4">
      {/* Counts */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Imported", value: summary.imported, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
          { label: "Skipped (dup.)", value: summary.duplicateCount, color: summary.duplicateCount > 0 ? "text-amber-700 bg-amber-50 border-amber-200" : "text-zinc-500 bg-zinc-50 border-zinc-200" },
          { label: "Errors", value: summary.errors.filter(e => e.rawName === "").length, color: summary.errors.filter(e => e.rawName === "").length > 0 ? "text-red-700 bg-red-50 border-red-200" : "text-zinc-500 bg-zinc-50 border-zinc-200" },
        ].map(({ label, value, color }) => (
          <div key={label} className={`rounded-lg border px-4 py-3 text-center ${color}`}>
            <p className="text-xl font-semibold">{value}</p>
            <p className="text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Warnings (rows imported but with issues) */}
      {summary.errors.filter(e => e.rawName !== "").length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm font-medium text-amber-800 mb-1">
            {summary.errors.filter(e => e.rawName !== "").length} contacts imported with warnings
          </p>
          <ul className="text-xs text-amber-700 space-y-0.5">
            {summary.errors.filter(e => e.rawName !== "").slice(0, 3).map((e, i) => (
              <li key={i}><strong>{e.rawName}</strong>: {e.errors.join("; ")}</li>
            ))}
            {summary.errors.filter(e => e.rawName !== "").length > 3 && (
              <li>…and {summary.errors.filter(e => e.rawName !== "").length - 3} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Skipped error rows */}
      {summary.errors.filter(e => e.rawName === "").length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-800">
                {summary.errors.filter(e => e.rawName === "").length} rows skipped (missing name)
              </p>
              <p className="text-xs text-red-600 mt-0.5">Fix these and re-import them separately.</p>
            </div>
            <button
              onClick={() => downloadErrorsCSV(summary.errors)}
              className="text-xs px-3 py-1.5 bg-red-700 text-white rounded-lg hover:bg-red-800"
            >
              Download errors.csv
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400">
        {summary.imported} contact{summary.imported !== 1 ? "s" : ""} added to this campaign.
      </p>
    </div>
  );

  return null;
}


import { useState, useRef } from "react";
import { parseCSVForMapping, autoDetectMapping, CSVColumn, ColumnMapping } from "@/lib/csv";

interface Props {
  campaignId: string;
  onImported: (count: number) => void;
}

type MappingField = keyof ColumnMapping;

const MAPPING_FIELDS: { key: MappingField; label: string; description: string; required: boolean }[] = [
  { key: "fullName", label: "Full name column", description: "e.g. 'Name', 'Voter Name', 'Full Name'", required: false },
  { key: "firstName", label: "First name column", description: "e.g. 'First Name', 'Given Name'", required: false },
  { key: "lastName", label: "Last name column", description: "e.g. 'Last Name', 'Surname'", required: false },
  { key: "phone", label: "Phone column", description: "e.g. 'Phone', 'Mobile', 'Cell'", required: false },
  { key: "email", label: "Email column", description: "e.g. 'Email', 'E-mail'", required: false },
  { key: "tags", label: "Tags column", description: "Comma-separated tags, e.g. 'district,ward'", required: false },
  { key: "notes", label: "Notes column", description: "Any extra notes or comments", required: false },
];

export default function CSVImporter({ campaignId, onImported }: Props) {
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "done">("upload");
  const [columns, setColumns] = useState<CSVColumn[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    fullName: null, firstName: null, lastName: null,
    phone: null, email: null, tags: null, notes: null,
  });
  const [validationError, setValidationError] = useState("");
  const [importing, setImporting] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSVForMapping(text);
      setColumns(result.columns);
      setRawRows(result.rows);
      setParseErrors(result.errors);
      // Auto-detect as a starting point — user must confirm
      setMapping(autoDetectMapping(result.columns));
      setStep("mapping");
    };
    reader.readAsText(file);
  }

  function validateMapping(): boolean {
    const hasName = mapping.fullName || mapping.firstName || mapping.lastName;
    if (!hasName) {
      setValidationError("You must map at least one name column (Full Name, or First + Last Name).");
      return false;
    }
    setValidationError("");
    return true;
  }

  async function handleImport() {
    if (!validateMapping()) return;
    setImporting(true);

    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId, rows: rawRows, mapping }),
    });

    const data = await res.json();
    setImporting(false);

    if (!res.ok) {
      setValidationError(data.error);
      return;
    }

    onImported(data.imported);
    setStep("done");
  }

  const colOptions = [
    <option key="" value="">— not in my file —</option>,
    ...columns.map((c) => (
      <option key={c.key} value={c.key}>
        {c.key}  {c.sample.length > 0 ? `(e.g. "${c.sample[0]}")` : ""}
      </option>
    )),
  ];

  if (step === "upload") return (
    <div className="border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center">
      <p className="text-sm text-zinc-500 mb-4">
        Upload a CSV or spreadsheet export of your voter/contact list.<br />
        Any format works — you'll map the columns in the next step.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt"
        onChange={handleFile}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="px-5 py-2.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 transition-colors"
      >
        Choose file
      </button>
      {parseErrors.length > 0 && (
        <p className="text-xs text-red-500 mt-3">Parse warnings: {parseErrors[0]}</p>
      )}
    </div>
  );

  if (step === "mapping") return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        We detected <strong>{rawRows.length}</strong> rows and <strong>{columns.length}</strong> columns.
        Tell us which column is which — we've made our best guess, but please verify.
      </div>

      <div className="space-y-4">
        {MAPPING_FIELDS.map((field) => {
          const col = columns.find((c) => c.key === (mapping[field.key] ?? ""));
          return (
            <div key={field.key} className="grid grid-cols-2 gap-4 items-start">
              <div>
                <label className="text-sm font-medium text-zinc-800 block">{field.label}</label>
                <p className="text-xs text-zinc-400 mt-0.5">{field.description}</p>
              </div>
              <div>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [field.key]: e.target.value || null }))
                  }
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
                >
                  {colOptions}
                </select>
                {col?.sample.length ? (
                  <p className="text-xs text-zinc-400 mt-1">
                    Sample values: {col.sample.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {validationError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {validationError}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => setStep("upload")}
          className="px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50"
        >
          Back
        </button>
        <button
          onClick={handleImport}
          disabled={importing}
          className="px-5 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-50"
        >
          {importing ? "Importing…" : `Import ${rawRows.length} contacts`}
        </button>
      </div>
    </div>
  );

  if (step === "done") return (
    <div className="text-center py-8">
      <div className="text-green-600 text-2xl mb-2">✓</div>
      <p className="text-zinc-700 font-medium">Contacts imported successfully</p>
      <p className="text-sm text-zinc-400 mt-1">Refresh the contacts list to see them.</p>
    </div>
  );

  return null;
}
