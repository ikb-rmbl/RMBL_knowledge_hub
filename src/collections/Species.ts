import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { flagsForItemField } from './shared/flagsField'

const TAXONOMIC_RANKS = [
  { label: 'Kingdom', value: 'kingdom' },
  { label: 'Phylum', value: 'phylum' },
  { label: 'Class', value: 'class' },
  { label: 'Order', value: 'order' },
  { label: 'Family', value: 'family' },
  { label: 'Genus', value: 'genus' },
  { label: 'Species', value: 'species' },
  { label: 'Subspecies', value: 'subspecies' },
]

const CONSERVATION_STATUSES = [
  { label: 'Least Concern (LC)', value: 'LC' },
  { label: 'Near Threatened (NT)', value: 'NT' },
  { label: 'Vulnerable (VU)', value: 'VU' },
  { label: 'Endangered (EN)', value: 'EN' },
  { label: 'Critically Endangered (CR)', value: 'CR' },
  { label: 'Extinct in the Wild (EW)', value: 'EW' },
  { label: 'Extinct (EX)', value: 'EX' },
  { label: 'Data Deficient (DD)', value: 'DD' },
  { label: 'Not Evaluated (NE)', value: 'NE' },
]

const NATIVE_STATUSES = [
  { label: 'Native', value: 'native' },
  { label: 'Introduced', value: 'introduced' },
  { label: 'Invasive', value: 'invasive' },
  { label: 'Unknown', value: 'unknown' },
]

export const Species: CollectionConfig = {
  slug: 'species',
  admin: {
    useAsTitle: 'canonicalName',
    defaultColumns: ['canonicalName', 'rank', 'family', 'publicationCount'],
    group: 'Entities',
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'canonicalName',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Full canonical name (e.g., "Marmota flaviventris")' },
    },
    {
      name: 'rank',
      type: 'select',
      required: true,
      options: TAXONOMIC_RANKS,
      defaultValue: 'species',
      admin: { description: 'Taxonomic rank' },
    },
    {
      name: 'scientificName',
      type: 'text',
      admin: { description: 'Scientific name (binomial for species)' },
    },
    {
      name: 'authority',
      type: 'text',
      admin: { description: 'Taxonomic authority (e.g., "Audubon, 1841")' },
    },
    // commonNames, synonyms: stored as Postgres text[] arrays (common_names,
    // synonyms). Payload's PG adapter would require junction tables for
    // hasMany text fields, which don't exist (the table was created via SQL
    // with push:false). Edit via the pipeline or SQL until those become
    // junction-table-backed; arrays remain visible on the public site.
    {
      name: 'parentTaxonId',
      type: 'number',
      admin: {
        description:
          'Parent taxon ID (integer FK into species). Direct ID edit; admin relationship picker disabled because the species_rels table is not provisioned.',
      },
    },
    {
      name: 'kingdom',
      type: 'text',
      index: true,
      admin: { description: 'Kingdom (denormalized for fast filtering)' },
    },
    {
      name: 'phylum',
      type: 'text',
      admin: { description: 'Phylum (denormalized)' },
    },
    {
      name: 'className',
      type: 'text',
      index: true,
      admin: { description: 'Class (denormalized)' },
    },
    {
      name: 'orderName',
      type: 'text',
      admin: { description: 'Order (denormalized)' },
    },
    {
      name: 'family',
      type: 'text',
      index: true,
      admin: { description: 'Family (denormalized)' },
    },
    {
      name: 'conservationStatus',
      type: 'select',
      options: CONSERVATION_STATUSES,
      admin: { description: 'IUCN conservation status if explicitly stated' },
    },
    {
      name: 'nativeToRmbl',
      type: 'select',
      options: NATIVE_STATUSES,
      admin: { description: 'Native status in the Gunnison Basin region' },
    },
    // ecologicalRoles: stored as Postgres text[] (ecological_roles). Hidden
    // from admin for the same reason as commonNames/synonyms above.
    {
      name: 'description',
      type: 'textarea',
      admin: { description: 'Curator-editable description' },
    },
    {
      name: 'externalIds',
      type: 'json',
      admin: { description: 'External database IDs: {gbif, itis, ncbi, eol, worms}' },
    },
    {
      name: 'imageUrl',
      type: 'text',
      admin: { description: 'CC-licensed thumbnail URL' },
    },
    {
      name: 'mentionCount',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { description: 'Cached count of entity_mentions rows', readOnly: true },
    },
    {
      name: 'publicationCount',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { description: 'Cached count of distinct publications mentioning this taxon', readOnly: true },
    },
    flagsForItemField,
  ],
}
