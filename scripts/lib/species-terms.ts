/**
 * Species text-search terms for backfill-species-mentions (and its audits).
 * See the rules comment in backfill-species-mentions.ts.
 */

export type SpeciesTermsInput = { id: number; canonical_name: string; scientific_name?: string | null; common_names: string[] | null; synonyms: string[] | null; mention_count?: number | null }

function isMultiWord(s: string): boolean {
  return /\S+\s+\S/.test(s)
}
function isCapitalizedSingle(s: string): boolean {
  return /^[A-Z][a-z]+$/.test(s) && s.length >= 6
}
/** Returns true for tokens that are too generic to anchor a species
 *  match: single letters (the "A" in "Species A"), or generic Latin
 *  placeholders ("sp.", "spp.", "species") that mean "an unspecified
 *  member of this genus" and therefore don't identify the species. */
function isJunkSecondToken(t: string): boolean {
  const norm = t.toLowerCase().replace(/\.$/, '')
  if (norm.length === 1) return true
  if (['sp', 'spp', 'species'].includes(norm)) return true
  return false
}
function isLatinBinomial(s: string): boolean {
  const m = /^([A-Z][a-z]+)\s+([a-z]\S*)/.exec(s)
  if (!m) return false
  // Reject "Bombus sp", "Bombus spp.", "Bombus species" — they're
  // genus-level shorthand and would match every paper that mentions any
  // member of the genus generically.
  return !isJunkSecondToken(m[2])
}
/** Reject "Species A", "Species B", "Genus X" etc — the LLM extracts these
 *  as synonyms when papers use letter codes for unnamed species in
 *  comparison tables. The text search would then hit every paper that
 *  uses the same phrase for any of its own unnamed species. */
function isPlaceholderPhrase(s: string): boolean {
  const tokens = s.trim().split(/\s+/)
  if (tokens.length !== 2) return false
  // Second token is a single uppercase letter (Species A / B / C)
  if (/^[A-Z]$/.test(tokens[1])) return true
  // Second token is sp / spp / species — covered by isLatinBinomial but
  // also catches "Genus sp" where the genus arrived via common_names.
  if (isJunkSecondToken(tokens[1])) return true
  return false
}

// "solitary bee" / "small mammal" / "native plants": unique to one registry row
// but generic in text. Only applied to common names and synonyms — an entity
// whose own name is generic ("small mammals") is a group entity and keeps it.
const GENERIC_ADJ = new Set(['small', 'large', 'solitary', 'social', 'native', 'wild', 'common', 'aquatic', 'terrestrial', 'flowering', 'woody', 'annual', 'perennial', 'alpine', 'montane', 'other', 'nonnative', 'non-native', 'invasive', 'exotic', 'many', 'some'])
const GENERIC_NOUN = /^(bees?|mammals?|birds?|fish(es)?|insects?|plants?|trees?|shrubs?|grass(es)?|herbs?|animals?|species|rodents?|flies|fly|moths?|spiders?|wasps?|ants?|worms?|flowers?|weeds?|forbs?|invertebrates?|vertebrates?|predators?|pollinators?|herbivores?|microbes?|fungi|fungus|algae?)$/
function isGenericPhrase(s: string): boolean {
  const w = s.trim().toLowerCase().split(/\s+/)
  return w.length === 2 && GENERIC_ADJ.has(w[0]) && GENERIC_NOUN.test(w[1])
}

export function termsFor(species: Omit<SpeciesTermsInput, 'id'>): string[] {
  const out = new Set<string>()
  // `allowSingleCap` controls whether `isCapitalizedSingle` applies. Latin
  // genus names ("Marmota") arrive via canonical_name and synonyms, so we
  // accept them there. Common-name fields can hold capitalized English
  // words ("Beaver", "Marmots") — tsvector is case-insensitive so those
  // would over-match every mention regardless of case. Skip them.
  const consider = (t: string | null | undefined, allowSingleCap: boolean) => {
    const s = (t || '').trim()
    if (!s) return
    if (isPlaceholderPhrase(s)) return    // "Species A", "Bombus sp."
    if (isLatinBinomial(s)) { out.add(s); return }
    if (isMultiWord(s) && s.length >= 8) { out.add(s); return }
    if (allowSingleCap && isCapitalizedSingle(s)) { out.add(s); return }
    // Otherwise: too generic to use as a backfill term.
  }
  consider(species.canonical_name, true)
  for (const cn of species.common_names || []) if (!isGenericPhrase(cn)) consider(cn, false)
  // A single capitalized synonym is a genus ("Bombus" on Bombus terrestris): it
  // names the entity only when the entity itself is genus-level. Otherwise every
  // paper mentioning the genus was linked to every species in it (2026-09-28).
  const genusLevel = !isMultiWord(species.canonical_name.trim())
  for (const syn of species.synonyms || []) if (!isGenericPhrase(syn)) consider(syn, genusLevel)
  return Array.from(out)
}

// Single-word entity names that are also ordinary words / surnames in papers:
// "Fisher" (the mammal) matched authors and Fisher's exact test.
const AMBIGUOUS_TERMS = new Set(['fisher', 'meridian', 'longhorn'])

/** Terms per species, where a term several species would use goes to one owner
 *  or to none. The registry has duplicates and cross-listed names (the genus row
 *  "Marmota" carries "Marmota flaviventris" and "yellow-bellied marmot" as its own
 *  synonyms), so plain uniqueness dropped the marmot binomial itself. Owner:
 *   1. the entity whose own name is the term (duplicate rows → most-mentioned);
 *   2. else the single species-rank entity (binomial name) using it — so
 *      "yellow-bellied marmot" goes to Marmota flaviventris, not the genus row;
 *   3. else nobody: "bumble bee" on fifteen Bombus species says none of them. */
export function specificTerms(list: SpeciesTermsInput[]): Map<number, string[]> {
  const byId = new Map(list.map((sp) => [sp.id, sp]))
  const perSpecies = new Map(list.map((sp) => [sp.id, termsFor(sp)]))
  const users = new Map<string, Set<number>>()
  for (const [id, terms] of perSpecies) {
    for (const t of terms) {
      const k = t.toLowerCase()
      if (!users.has(k)) users.set(k, new Set())
      users.get(k)!.add(id)
    }
  }
  const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()
  const byMentions = (a: number, b: number) => (byId.get(b)!.mention_count ?? 0) - (byId.get(a)!.mention_count ?? 0) || a - b
  const owner = new Map<string, number | null>()
  for (const [k, ids] of users) {
    if (ids.size === 1) { owner.set(k, [...ids][0]); continue }
    const named = [...ids].filter((id) => norm(byId.get(id)!.canonical_name) === k || norm(byId.get(id)!.scientific_name) === k)
    if (named.length) { owner.set(k, named.sort(byMentions)[0]); continue }
    const speciesRank = [...ids].filter((id) => isMultiWord(byId.get(id)!.canonical_name.trim()))
    owner.set(k, speciesRank.length === 1 ? speciesRank[0] : null)
  }
  for (const [id, terms] of perSpecies) {
    perSpecies.set(id, terms.filter((t) => owner.get(t.toLowerCase()) === id && !AMBIGUOUS_TERMS.has(t.toLowerCase())))
  }
  return perSpecies
}
