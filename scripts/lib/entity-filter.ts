/**
 * Filter for "junk" entity names that aren't real entities — the LLM
 * extracted them as placeholders when source text didn't actually name a
 * species/concept/stakeholder. Examples: "Unknown", "not specified",
 * "not mentioned", "N/A", "various", "sp." etc.
 *
 * Used at INSERT sites in species / concept / stakeholder canonicalization
 * to prevent these from being created as canonical entities. Also useful
 * as a defensive filter at any UI surface that displays entity names.
 *
 * Returns true if the name should be SKIPPED (treated as junk).
 */
export function isJunkEntityName(name: string | null | undefined): boolean {
  if (!name) return true
  const n = name.trim().toLowerCase()
  if (n.length === 0) return true

  // Exact matches (the LLM's typical "I don't know" placeholders)
  const EXACT_JUNK = new Set([
    'unknown',
    'unspecified',
    'unidentified',
    'undetermined',
    'undefined',
    'not specified',
    'not mentioned',
    'not identified',
    'not given',
    'not stated',
    'not applicable',
    'not available',
    'none',
    'n/a',
    'na',
    'nil',
    'null',
    'tbd',
    'various',
    'multiple',
    'misc',
    'miscellaneous',
    'other',
    'others',
    'sp.',
    'spp.',
    'sp',
    'spp',
    'unknown species',
    'unknown taxa',
    'unspecified species',
    'multiple species',
    'various species',
  ])
  if (EXACT_JUNK.has(n)) return true

  // Phrase patterns (the LLM sometimes wraps the placeholder in extra words)
  if (/^(not |un)(specified|mentioned|identified|determined|known|defined|stated|given|named|listed)\b/.test(n)) return true
  if (/^no (taxon|species|name|specific|particular)\b/.test(n)) return true

  return false
}
