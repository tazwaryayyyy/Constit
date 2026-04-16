"use client";
// components/CSVImporter.tsx
// CRITICAL FIX #2: Full column mapping UI. Never silently guess.

import { useState, useRef } from "react";
import { parseCSVForMapping, autoDetectMapping, CSVColumn, ColumnMapping } from "@/lib/csv";

interface Props {
  campaignId: string;
  onImported: (count: number) => void;
}

type MappingField = keyof ColumnMapping;

const MAPPING_FIELDS: { key: MappingField; label: string; description: string; required: boolean }[] = [
  { key: "fullName",  label: "Full name column",   description: "e.g. 'Name', 'Voter Name', 'Full Name'",        required: false },
  { key: "firstName", label: "First name column",   description: "e.g. 'First Name', 'Given Name'",              required: false },
  { key: "lastName",  label: "Last name column",    description: "e.g. 'Last Name', 'Surname'",                  required: false },
  { key: "phone",     label: "Phone column",        description: "e.g. 'Phone', 'Mobile', 'Cell'",               required: false },
  { key: "email",     label: "Email column",        description: "e.g. 'Email', 'E-mail'",                       required: false },
  { key: "tags",      label: "Tags column",         description: "Comma-separated tags, e.g. 'district,ward'",   required: false },
  { key: "notes",     label: "Notes column",        description: "Any extra notes or comments",                  required: false },
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
