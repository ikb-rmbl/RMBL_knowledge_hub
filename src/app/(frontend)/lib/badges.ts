/**
 * Shared badge label and color logic for resource type display.
 *
 * Color encodes the collection (green=document, blue=publication, amber=dataset).
 * Text encodes the specific subtype for scannability.
 */

const PUB_TYPE_LABELS: Record<string, string> = {
  article: 'Article',
  thesis: 'Thesis',
  book: 'Book',
  chapter: 'Chapter',
  student_paper: 'Student Paper',
  other: 'Publication',
}

const DATASET_TYPE_LABELS: Record<string, string> = {
  dataset: 'Dataset',
  software: 'Software',
  collection: 'Collection',
  service: 'Service',
  other: 'Dataset',
}

export function getBadgeLabel(
  collection: 'document' | 'publication' | 'dataset',
  subtype?: string | null,
): string {
  switch (collection) {
    case 'publication':
      return PUB_TYPE_LABELS[subtype || ''] || 'Publication'
    case 'dataset':
      return DATASET_TYPE_LABELS[subtype || ''] || 'Dataset'
    case 'document':
      return 'Document'
  }
}

/**
 * CSS class for badge color. The collection determines the color:
 *   document  → green (badge-document)
 *   publication → blue (badge-publication)
 *   dataset → amber (badge-dataset)
 */
export function getBadgeClass(collection: 'document' | 'publication' | 'dataset'): string {
  return `badge badge-${collection}`
}
