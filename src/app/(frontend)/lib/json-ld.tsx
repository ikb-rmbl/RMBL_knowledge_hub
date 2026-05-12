/**
 * JSON-LD structured data helpers for Schema.org and Bioschemas markup.
 */

export function JsonLd({ data }: { data: Record<string, any> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function publicationJsonLd(pub: any, authors?: any[]): Record<string, any> {
  const ld: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    name: pub.title,
    url: `https://rmblknowledgefabric.org/publications/${pub.id}`,
  }
  if (pub.year) ld.datePublished = String(pub.year)
  if (pub.abstract) ld.abstract = pub.abstract.slice(0, 500)
  if (pub.journal) ld.isPartOf = { '@type': 'Periodical', name: pub.journal }
  if (pub.doi) ld.identifier = { '@type': 'PropertyValue', propertyID: 'DOI', value: pub.doi }
  if (authors?.length) {
    ld.author = authors.map((a: any) => {
      const person: Record<string, any> = { '@type': 'Person', name: a.display_name || `${a.given_name || ''} ${a.family_name}`.trim() }
      if (a.orcid) person.identifier = `https://orcid.org/${a.orcid}`
      return person
    })
  }
  return ld
}

export function datasetJsonLd(ds: any): Record<string, any> {
  const ld: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: ds.title,
    url: `https://rmblknowledgefabric.org/datasets/${ds.id}`,
  }
  if (ds.description) ld.description = ds.description.slice(0, 500)
  if (ds.doi) ld.identifier = ds.doi
  if (ds.repository) ld.provider = { '@type': 'Organization', name: ds.repository }
  if (ds.temporal_extent_start && ds.temporal_extent_end) {
    ld.temporalCoverage = `${new Date(ds.temporal_extent_start).getFullYear()}/${new Date(ds.temporal_extent_end).getFullYear()}`
  }
  ld.spatialCoverage = { '@type': 'Place', name: 'Gunnison Basin, Colorado' }
  return ld
}

export function speciesJsonLd(species: any): Record<string, any> {
  const ld: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Taxon',
    name: species.canonical_name,
    taxonRank: species.rank || 'species',
    url: `https://rmblknowledgefabric.org/species/${species.id}`,
  }
  if (species.common_names?.length) ld.alternateName = species.common_names
  if (species.family) {
    ld.parentTaxon = { '@type': 'Taxon', name: species.family, taxonRank: 'family' }
  }
  if (species.external_ids?.itis) {
    ld.identifier = { '@type': 'PropertyValue', propertyID: 'ITIS TSN', value: String(species.external_ids.itis) }
  }
  return ld
}

export function neighborhoodJsonLd(nbr: any): Record<string, any> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Collection',
    name: nbr.title,
    description: nbr.summary || undefined,
    url: `https://rmblknowledgefabric.org/neighborhoods/${nbr.id}`,
    numberOfItems: nbr.size,
    provider: { '@type': 'Organization', name: 'Rocky Mountain Biological Laboratory' },
  }
}
