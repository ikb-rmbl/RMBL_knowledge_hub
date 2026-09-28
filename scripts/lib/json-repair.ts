/**
 * Escape raw control characters (newline, tab, CR…) that appear INSIDE JSON
 * string literals. LLMs sometimes emit multi-paragraph string values with
 * literal newlines, which strict JSON.parse rejects ("Invalid control
 * character"); structural whitespace outside strings is left untouched.
 */
export function escapeControlCharsInStrings(s: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of s) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue }
      if (ch === '\\') { escaped = true; out += ch; continue }
      if (ch === '"') { inString = false; out += ch; continue }
      const code = ch.charCodeAt(0)
      if (code < 0x20) {
        out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`
        continue
      }
      out += ch
    } else {
      if (ch === '"') inString = true
      out += ch
    }
  }
  return out
}
