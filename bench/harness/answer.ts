export interface JsonSpan {
  start: number;
  end: number;
  text: string;
}

export function balancedJsonSpans(text: string): JsonSpan[] {
  const spans: JsonSpan[] = [];
  for (let start = 0; start < text.length; start += 1) {
    const first = text[start];
    if (first !== "{" && first !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) {
          spans.push({ start, end: i + 1, text: text.slice(start, i + 1) });
          break;
        }
      }
    }
  }
  // Keep only root spans: those not fully contained within another span. This
  // discards nested objects/arrays (e.g. the "edges" list inside a path answer)
  // so the final answer is the outermost JSON, not one of its parts.
  return spans.filter(
    (a) => !spans.some((b) => b !== a && b.start <= a.start && a.end <= b.end),
  );
}

export function extractAnswer(texts: string[]): {
  answer?: unknown;
  error?: string;
} {
  const cleaned = texts
    .join("\n")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const roots = balancedJsonSpans(cleaned);
  // Walk from the last root-level JSON backwards: the model may emit prose
  // before its final answer, so the final answer is the last top-level JSON.
  for (let i = roots.length - 1; i >= 0; i -= 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(roots[i]!.text) as unknown;
    } catch {
      continue;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if ("answer" in record) return { answer: record.answer };
      if ("exists" in record || "nodes" in record) return { answer: record };
    }
    if (Array.isArray(parsed)) return { answer: parsed };
  }
  return { error: "no parseable JSON answer" };
}
