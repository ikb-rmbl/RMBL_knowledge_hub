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
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  species: 'Species',
  protocol: 'Protocol',
  concept: 'Concept',
  author: 'Author',
  publication: 'Publication',
}
