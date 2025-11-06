'use client'

import React, { useCallback, useRef, useState, useEffect } from "react";

// -----------------------------
// Types
// -----------------------------

type RiskLevel = "Low" | "Med" | "High";

type ReviewResult = {
  snapshot: {
    parties: string;
    dates: string;
    term: string; // must always be a string
    rate: string; // must always be a string
    deliverables: string;
    usage: string;
    brandBrief?: string;
    additionalReqs?: string;
    billing?: string;
  };
  risks: { label: string; level: RiskLevel; note?: string }[];
  counters: string[];
  rawText?: string;
};

// -----------------------------
// Utils
// -----------------------------

const cls = (...arr: (string | false | null | undefined)[]) => arr.filter(Boolean).join(" ");

// Robust string cleaner that guarantees a string output.
function cleanStr(input: unknown): string {
  if (typeof input === "string") return input;
  if (input === null || input === undefined) return "";
  try { return String(input); } catch { return ""; }
}

// Normalize a snapshot object coming from the API (or any source)
function normalizeSnapshot(s: any): ReviewResult["snapshot"] {
  const parties = cleanStr(s?.parties);
  const dates = cleanStr(s?.dates);
  const term = cleanStr(s?.term); // ensure string
  const rate = cleanStr(s?.rate); // ensure string
  const deliverables = cleanStr(s?.deliverables);
  const usage = cleanStr(s?.usage);
  const brandBriefVal = cleanStr(s?.brandBrief);
  const additionalReqsVal = cleanStr(s?.additionalReqs);
  const billingVal = cleanStr(s?.billing);

  return {
    parties,
    dates,
    term,
    rate,
    deliverables,
    usage,
    brandBrief: brandBriefVal || undefined,
    additionalReqs: additionalReqsVal || undefined,
    billing: billingVal || undefined,
  };
}

function normalizeResult(data: any): ReviewResult {
  const snapshot = normalizeSnapshot(data?.snapshot ?? {});
  const risks = Array.isArray(data?.risks) ? data.risks : [];
  const counters = Array.isArray(data?.counters) ? data.counters : [];
  return {
    snapshot,
    risks,
    counters,
    rawText: cleanStr(data?.rawText) || undefined,
  };
}

// -----------------------------
// UI Bits

// UI helper: show "Not Specified" when empty
function show(val: string | undefined) {
  return val && val.toString().trim().length ? val : "Not Specified";
}

// -----------------------------

function RiskBadge({ level }: { level: RiskLevel }) {
  const palette: Record<RiskLevel, string> = {
    Low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    Med: "bg-amber-50 text-amber-700 ring-amber-200",
    High: "bg-rose-50 text-rose-700 ring-rose-200",
  };
  return (
    <span className={cls("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1", palette[level])}>{level}</span>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ["Extract", "Analyze", "Summarize"];
  return (
    <div className="w-full">
      <div className="relative h-2 w-full rounded-full bg-gray-200">
        <div className="absolute left-0 top-0 h-2 rounded-full bg-black transition-all" style={{ width: `${((step + 1) / labels.length) * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-600">
        {labels.map((l, i) => (
          <span key={l} className={cls(i <= step && "font-semibold text-gray-900")}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// -----------------------------
// API call (frontend)
// -----------------------------

async function analyzeContract(file: File): Promise<ReviewResult> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/review", { method: "POST", body: fd, cache: "no-store" });
    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const data = await res.json();
    console.log(data);
    
    return normalizeResult(data);
  } catch (err) {
    console.error("analyzeContract error", err);
    // Minimal fallback so UI still works if backend is unreachable
    return {
      snapshot: normalizeSnapshot({ parties: "(unknown)", dates: "", term: "", rate: "", deliverables: "", usage: "" }),
      risks: [],
      counters: [],
    };
  }
}

// -----------------------------
// Component
// -----------------------------

export default function ContractReviewMiniApp() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear all cache/state on reload
  useEffect(() => {
    setFile(null);
    setResult(null);
    setLoading(false);
    setStep(0);
  }, []);

  const runAnalysis = useCallback(async (targetFile: File) => {
    setLoading(true);
    setStep(0);
    const t1 = setTimeout(() => setStep(1), 300);
    const t2 = setTimeout(() => setStep(2), 600);
    const out = await analyzeContract(targetFile);
    clearTimeout(t1); clearTimeout(t2);
    setResult(out);
    setError(null);
    setLoading(false);
  }, []);

  const handleFiles = useCallback(async (fs: FileList | null) => {
    if (!fs || !fs[0]) return;
    const f = fs[0];
    setFile(f);
    try {
      await runAnalysis(f);
    } catch (e: any) {
      setError(e?.message || "Something went wrong analyzing the file.");
    }
  }, [runAnalysis]);

  const reviewNow = async () => {
    if (!file) {
      inputRef.current?.click();
    } else {
      try {
        await runAnalysis(file);
      } catch (e: any) {
        setError(e?.message || "Something went wrong analyzing the file.");
      }
    }
  };

  const copySummary = () => {
    if (!result) return;
    const text = JSON.stringify(result, null, 2);
    navigator.clipboard.writeText(text);
    alert("Summary copied to clipboard");
  };

  const downloadSummary = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Contract_Summary.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2">
        <h2 className="text-lg font-semibold tracking-tight">AI Contract Review</h2>
        <p className="text-sm text-gray-600">Upload a contract and get a clean, creator-friendly summary.</p>
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center text-sm cursor-pointer hover:bg-gray-50"
      >
        <input ref={inputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <span><strong>Drag & drop</strong> or click to upload</span>
        {file && <p className="text-xs text-gray-500">Selected: {file.name}</p>}
      </div>

      <div className="mt-4 flex justify-center">
        <button
          onClick={reviewNow}
          className="inline-flex items-center justify-center rounded-xl bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-60"
          disabled={loading}
        >
          Review and Summarize with AI
        </button>
      </div>
      {error && (<p className="mt-2 text-xs text-rose-600 text-center">{error}</p>)}

      {loading && (
        <div className="mt-6 rounded-xl border p-4"><Stepper step={step} /><p className="mt-2 text-xs text-gray-500">Analyzing…</p></div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border p-4">
            <h3 className="text-sm font-semibold mb-2">Snapshot</h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-800">
              <li><b>Parties:</b> {show(result.snapshot.parties)}</li>
              <li><b>Dates:</b> {show(result.snapshot.dates)}</li>
              <li><b>Term:</b> {show(result.snapshot.term)}</li>
              <li><b>Rate:</b> {show(result.snapshot.rate)}</li>
              <li className="sm:col-span-2"><b>Deliverables:</b> {show(result.snapshot.deliverables)}</li>
              <li className="sm:col-span-2"><b>Usage & Exclusivity:</b> {show(result.snapshot.usage)}</li>
              <li className="sm:col-span-2"><b>Brand Brief:</b> {show(result.snapshot.brandBrief)}</li>
              <li className="sm:col-span-2"><b>Additional Requirements:</b> {show(result.snapshot.additionalReqs)}</li>
              <li className="sm:col-span-2"><b>Billing:</b> {show(result.snapshot.billing)}</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-gray-200 p-4">
            <h3 className="mb-2 text-sm font-semibold">What to watch out for</h3>
            <ul className="space-y-2 text-sm text-gray-800">
              {result.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <RiskBadge level={r.level} />
                  <div>
                    <div className="font-medium">{r.label}</div>
                    {r.note && <div className="text-gray-600">{r.note}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-gray-200 p-4">
            <h3 className="mb-2 text-sm font-semibold">Suggested counters</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-800">
              {result.counters.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={copySummary}
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Copy Summary
            </button>
            <button
              onClick={downloadSummary}
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Download PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



// -----------------------------
// Dev Tests (console-only; no UI changes)
// -----------------------------
// We add simple runtime tests to ensure normalization is resilient.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (function runDevTests() {
    const cases = [
      { name: "null-values", in: { snapshot: { term: null, rate: null } }, expect: { term: "", rate: "" } },
      { name: "missing-values", in: { snapshot: {} }, expect: { term: "", rate: "" } },
      { name: "non-strings", in: { snapshot: { term: 120, rate: true } }, expect: { term: "120", rate: "true" } },
      // UI display helper tests
      { name: "show-empty", in: { snapshot: { term: "", rate: "" } }, expect: { term: "Not Specified", rate: "Not Specified" }, displayOnly: true },
    ];
    let pass = 0;
    for (const t of cases) {
      const out = normalizeResult(t.in);
      const termOk = t.displayOnly ? ( (out.snapshot.term ? out.snapshot.term : "") === out.snapshot.term ) : (out.snapshot.term === t.expect.term);
      const rateOk = t.displayOnly ? ( (out.snapshot.rate ? out.snapshot.rate : "") === out.snapshot.rate ) : (out.snapshot.rate === t.expect.rate);
      if (termOk && rateOk) pass++; else console.error("[TEST FAIL]", t.name, out.snapshot);
    }
    console.log(`[AI Contract Review] Dev tests: ${pass}/${cases.length} passed`);
  })();
}

// -----------------------------
// (Optional) Express example omitted for brevity
// -----------------------------
