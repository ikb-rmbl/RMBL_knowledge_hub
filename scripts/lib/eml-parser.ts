/**
 * EML (Ecological Metadata Language) XML parser.
 *
 * Extracts structured metadata from EML documents used by DataONE,
 * ESS-DIVE, EDI, and other ecological data repositories.
 */

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

export function xmlText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(re)
  if (!match) return null
  return match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function xmlTextAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  const results: string[] = []
  let match
  while ((match = re.exec(xml))) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text) results.push(text)
  }
  return results
}

// ---------------------------------------------------------------------------
// EML parser
// ---------------------------------------------------------------------------

export interface EmlMetadata {
  title: string | null
  abstract: string | null
  methods: string | null
  keywords: string[]
  geographicDescription: string | null
  creators: { name: string; affiliation: string | null }[]
  license: string | null
  doi: string | null
  fullText: string
}

export function parseEml(xml: string): EmlMetadata {
  const title = xmlText(xml, 'title')
  const abstract = xmlText(xml, 'abstract')
  const methods = xmlTextAll(xml, 'methodStep').join('\n\n') || xmlText(xml, 'methods') || null
  const geoDesc = xmlText(xml, 'geographicDescription')
  const keywords = xmlTextAll(xml, 'keyword')
  const license = xmlText(xml, 'intellectualRights')

  // Extract DOI from alternateIdentifier or packageId
  let doi: string | null = null
  const altIds = xmlTextAll(xml, 'alternateIdentifier')
  for (const id of altIds) {
    const doiMatch = id.match(/10\.\d{4,}\/\S+/)
    if (doiMatch) { doi = doiMatch[0].replace(/[.,;)\s]+$/, ''); break }
  }
  if (!doi) {
    // Try packageId attribute
    const pkgMatch = xml.match(/packageId="([^"]*)"/)
    if (pkgMatch) {
      const doiMatch = pkgMatch[1].match(/10\.\d{4,}\/\S+/)
      if (doiMatch) doi = doiMatch[0].replace(/[.,;)\s]+$/, '')
    }
  }

  // Parse creators with affiliations
  const creators: { name: string; affiliation: string | null }[] = []
  const creatorBlocks = xml.match(/<creator[^>]*>[\s\S]*?<\/creator>/gi) || []
  for (const block of creatorBlocks) {
    const given = xmlText(block, 'givenName') || ''
    const sur = xmlText(block, 'surName') || ''
    const org = xmlText(block, 'organizationName') || ''
    if (given || sur) {
      creators.push({ name: `${given} ${sur}`.trim(), affiliation: org || null })
    } else if (org) {
      creators.push({ name: org, affiliation: null })
    }
  }

  const parts = [title, abstract, methods, geoDesc, ...keywords].filter(Boolean)

  return {
    title,
    abstract,
    methods,
    keywords,
    geographicDescription: geoDesc,
    creators,
    license,
    doi,
    fullText: parts.join('\n\n'),
  }
}
