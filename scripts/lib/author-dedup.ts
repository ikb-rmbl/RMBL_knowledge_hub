/**
 * Author deduplication logic.
 *
 * Shared between build-author-registry.ts (inline dedup after extraction)
 * and dedup-authors.ts (standalone re-dedup).
 */

export interface AuthorRecord {
  id: string
  displayName: string
  familyName: string
  givenName: string
  orcid: string | null
  affiliation: string | null
  publicationIds: string[]
  datasetIds: string[]
  documentIds: string[]
}

function initialsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  const getInitials = (s: string) =>
    s.replace(/\./g, ' ').trim().split(/\s+/).map((p) => p.charAt(0).toUpperCase()).filter(Boolean)

  const ai = getInitials(a)
  const bi = getInitials(b)
  if (ai.length === 0 || bi.length === 0) return false
  if (ai[0] !== bi[0]) return false

  // If both have 2+ initials, ALL shared positions must match.
  // This prevents merging "R. J. Smith" with "R. A. Smith" — different
  // middle initials are a strong signal of different people.
  if (ai.length >= 2 && bi.length >= 2) {
    const minLen = Math.min(ai.length, bi.length)
    for (let i = 0; i < minLen; i++) {
      if (ai[i] !== bi[i]) return false
    }
  }
  // If only one has a middle initial, we allow the match but it's weaker.
  // The caller (deduplicateAuthors) applies additional checks.
  return true
}

function mergeAuthors(primary: AuthorRecord, secondary: AuthorRecord): AuthorRecord {
  const familyName = primary.familyName.length >= secondary.familyName.length ? primary.familyName : secondary.familyName
  const givenName = primary.givenName.length >= secondary.givenName.length ? primary.givenName : secondary.givenName
  return {
    id: primary.orcid || secondary.orcid || primary.id,
    familyName,
    givenName,
    displayName: givenName ? `${givenName} ${familyName}` : familyName,
    orcid: primary.orcid || secondary.orcid,
    affiliation: primary.affiliation || secondary.affiliation,
    publicationIds: [...new Set([...primary.publicationIds, ...secondary.publicationIds])],
    datasetIds: [...new Set([...primary.datasetIds, ...secondary.datasetIds])],
    documentIds: [...new Set([...primary.documentIds, ...secondary.documentIds])],
  }
}

/**
 * Deduplicate an author list in place.
 * Returns the deduplicated array and merge count.
 */
export function deduplicateAuthors(authors: AuthorRecord[]): { result: AuthorRecord[]; orcidMerges: number; nameMerges: number } {
  let orcidMerges = 0
  let nameMerges = 0

  // Phase 1: Merge by ORCID
  const byOrcid = new Map<string, AuthorRecord[]>()
  for (const a of authors) {
    if (a.orcid) {
      if (!byOrcid.has(a.orcid)) byOrcid.set(a.orcid, [])
      byOrcid.get(a.orcid)!.push(a)
    }
  }
  const mergedIds = new Set<string>()
  for (const [, group] of byOrcid) {
    if (group.length > 1) {
      let primary = group[0]
      for (let i = 1; i < group.length; i++) {
        primary = mergeAuthors(primary, group[i])
        mergedIds.add(group[i].id)
        orcidMerges++
      }
      Object.assign(group[0], primary)
    }
  }

  let remaining = authors.filter((a) => !mergedIds.has(a.id))

  // Phase 2: Merge by family name + initials/name similarity
  const byFamily = new Map<string, AuthorRecord[]>()
  for (const a of remaining) {
    const key = a.familyName.toLowerCase()
    if (!byFamily.has(key)) byFamily.set(key, [])
    byFamily.get(key)!.push(a)
  }

  const namesMerged = new Set<string>()
  for (const [, group] of byFamily) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      if (namesMerged.has(group[i].id)) continue
      for (let j = i + 1; j < group.length; j++) {
        if (namesMerged.has(group[j].id)) continue
        const a = group[i], b = group[j]
        if (!initialsMatch(a.givenName, b.givenName)) continue

        const aIsInitials = a.givenName.replace(/\./g, '').replace(/\s/g, '').length <= 4
        const bIsInitials = b.givenName.replace(/\./g, '').replace(/\s/g, '').length <= 4

        if (!aIsInitials && !bIsInitials) {
          const aGiven = a.givenName.toLowerCase()
          const bGiven = b.givenName.toLowerCase()
          if (aGiven !== bGiven && !aGiven.startsWith(bGiven) && !bGiven.startsWith(aGiven)) continue
        }

        const merged = mergeAuthors(a, b)
        Object.assign(group[i], merged)
        namesMerged.add(b.id)
        nameMerges++
      }
    }
  }

  remaining = remaining.filter((a) => !namesMerged.has(a.id))

  return { result: remaining, orcidMerges, nameMerges }
}
