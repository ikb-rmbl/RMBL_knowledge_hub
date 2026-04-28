/** Entity type → color mapping for graph nodes. Matches badge colors in styles.css. */
export const GRAPH_COLORS: Record<string, string> = {
  species: '#558b2f',
  place: '#6d4c41',
  protocol: '#1565c0',
  concept: '#7b1fa2',
  author: '#c62828',
  publication: '#3a6b7b',
  dataset: '#7b5a3a',
  document: '#6b7b3a',
  story: '#7a4a6b',
  stakeholder: '#546e7a',
}

export const STAKEHOLDER_COLORS: Record<string, string> = {
  federal_agency: '#1565c0',
  state_agency: '#2e7d32',
  local_gov: '#6d4c41',
  academic: '#7b1fa2',
  ngo: '#c62828',
  industry: '#e65100',
  tribal: '#558b2f',
  other: '#999',
}

export const ENTITY_SLUG_MAP: Record<string, string> = {
  species: 'species', place: 'places', protocol: 'protocols', concept: 'concepts',
  author: 'authors', publication: 'publications', dataset: 'datasets',
  document: 'documents', story: 'stories', stakeholder: 'stakeholders',
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  species: 'Species',
  place: 'Place',
  protocol: 'Protocol',
  concept: 'Concept',
  author: 'Author',
  publication: 'Publication',
  dataset: 'Dataset',
  document: 'Document',
  story: 'Story',
  stakeholder: 'Stakeholder',
}
