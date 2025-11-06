// -----------------------------
// Next.js API route (app/api/review/route.ts)
// -----------------------------

  // NOTE: For the canvas preview to compile, the server route (which imports "next/server",
  // "openai", etc.) must live in its own file inside your Next.js app, not in this React file.
  // Copy the following into: app/api/review/route.ts  (do not keep it in this component file!)

  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  import { NextRequest, NextResponse } from "next/server";
  import OpenAI from "openai";
  import pdfParse from "pdf-parse";
  import * as mammoth from "mammoth";

  function s_cleanStr(input: unknown): string {
    if (typeof input === "string") return input;
    if (input === null || input === undefined) return "";
    try { return String(input); } catch { return ""; }
  }
  function s_normalizeSnapshot(s: any) {
    const parties = s_cleanStr(s?.parties);
    const dates = s_cleanStr(s?.dates);
    const term = s_cleanStr(s?.term);
    const rate = s_cleanStr(s?.rate);
    const deliverables = s_cleanStr(s?.deliverables);
    const usage = s_cleanStr(s?.usage);
    const brandBrief = s_cleanStr(s?.brandBrief);
    const additionalReqs = s_cleanStr(s?.additionalReqs);
    const billing = s_cleanStr(s?.billing);
    return {
      parties,
      dates,
      term,
      rate,
      deliverables,
      usage,
      brandBrief: brandBrief || undefined,
      additionalReqs: additionalReqs || undefined,
      billing: billing || undefined,
    };
  }

  async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    const out = await pdfParse(buffer);
    return out.text || "";
  }
  async function extractTextFromDOCX(arrayBuffer: ArrayBuffer): Promise<string> {
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value || "";
  }
  function looksLikePDF(filename?: string, mime?: string) {
    return (mime?.includes("pdf") ?? false) || (filename?.toLowerCase().endsWith(".pdf") ?? false);
  }
  function looksLikeDOCX(filename?: string, mime?: string) {
    const n = filename?.toLowerCase() || "";
    return (mime?.includes("word") ?? false) || n.endsWith(".docx") || n.endsWith(".doc");
  }

  export async function POST(req: NextRequest) {
    try {
      const form = await req.formData();
      const file = form.get("file") as unknown as File | null;
      if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

      const MAX_BYTES = 15 * 1024 * 1024; // 15MB
      const fname = (file as any).name as string | undefined;
      const mime = (file as any).type as string | undefined;
      const size = (file as any).size as number | undefined;
      if (typeof size === "number" && size > MAX_BYTES) {
        return NextResponse.json({ error: `File too large (max 15MB).` }, { status: 413 });
      }
      const allowed = /\.(pdf|docx?|rtf)$/i;
      if (fname && !allowed.test(fname)) {
        return NextResponse.json({ error: "Unsupported file type. Please upload a PDF or Word document." }, { status: 415 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let text = "";
      if (looksLikePDF(fname, mime)) {
        try { text = await extractTextFromPDF(buffer); }
        catch { return NextResponse.json({ error: "Unable to parse PDF. If it's password-protected, export an unlocked copy and re-upload." }, { status: 422 }); }
      } else if (looksLikeDOCX(fname, mime) || /\.doc$/i.test(fname || "")) {
        try { text = await extractTextFromDOCX(arrayBuffer); }
        catch { return NextResponse.json({ error: "Unable to read Word file. Try saving as DOCX or PDF and re-upload." }, { status: 422 }); }
      } else {
        try { text = await extractTextFromPDF(buffer); } catch {}
        if (!text) { try { text = await extractTextFromDOCX(arrayBuffer); } catch {} }
      }
      if (!text || text.trim().length < 20) {
        return NextResponse.json({ error: "We couldn't extract readable text. Please export to PDF or DOCX and re-upload." }, { status: 422 });
      }

      const TEXT_LIMIT = 50000; // chars
      const trimmed = text.slice(0, TEXT_LIMIT);

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const system = `You are a contracts analyst for creator/brand deals. Return STRICT JSON only. Fields:
{
  "snapshot": {"parties":string,"dates":string,"term":string,"rate":string,"deliverables":string,"usage":string,"brandBrief":string|null,"additionalReqs":string|null,"billing":string|null},
  "risks": Array<{"label":string,"level":"Low"|"Med"|"High","note"?:string}>,
  "counters": string[]
}
Do NOT include late fees in counters.`;
      const user = `Contract text:

${trimmed}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [ { role: "system", content: system }, { role: "user", content: user } ],
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content ?? "{}";
      let data: any; try { data = JSON.parse(content); } catch { data = {}; }

      const out = {
        snapshot: s_normalizeSnapshot(data?.snapshot ?? {}),
        risks: Array.isArray(data?.risks) ? data.risks : [],
        counters: (Array.isArray(data?.counters) ? data.counters : []).filter((c: string) => !/late fee/i.test(c)),
        rawText: trimmed,
      };

      return new NextResponse(JSON.stringify(out), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
      });
    } catch (err: any) {
      console.error("/api/review error", err);
      return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
    }
  }
