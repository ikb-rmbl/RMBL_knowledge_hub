import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { flagsForItemField } from './shared/flagsField'

const CONCEPT_TYPES = [
  { label: 'Theory', value: 'theory' },
  { label: 'Hypothesis', value: 'hypothesis' },
  { label: 'Process', value: 'process' },
  { label: 'Phenomenon', value: 'phenomenon' },
  { label: 'Measurement', value: 'measurement' },
  { label: 'Metric', value: 'metric' },
  { label: 'Framework', value: 'framework' },
  { label: 'Model Type', value: 'model_type' },
]

const CONCEPT_SCOPES = [
  { label: 'General Ecology', value: 'general_ecology' },
  { label: 'Climate', value: 'climate' },
  { label: 'Hydrology', value: 'hydrology' },
  { label: 'Population Ecology', value: 'population_ecology' },
  { label: 'Community Ecology', value: 'community_ecology' },
  { label: 'Evolution', value: 'evolution' },
  { label: 'Biogeochemistry', value: 'biogeochemistry' },
  { label: 'Landscape', value: 'landscape' },
  { label: 'Molecular', value: 'molecular' },
  { label: 'Methodological', value: 'methodological' },
]

export const Concepts: CollectionConfig = {
  slug: 'concepts',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'conceptType', 'scope', 'publicationCount'],
    group: 'Entities',
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Canonical concept name (e.g., "phenological mismatch", "NDVI")' },
    },
    {
      name: 'conceptType',
      type: 'select',
      options: CONCEPT_TYPES,
      index: true,
    },
    {
      name: 'definition',
      type: 'textarea',
      admin: { description: '1-2 sentence definition' },
    },
    {
      name: 'scope',
      type: 'select',
      options: CONCEPT_SCOPES,
      index: true,
    },
    // aliases: stored as Postgres text[]. Hidden from admin until junction
    // tables are provisioned; public site still reads the array directly.
    {
      name: 'parentConceptId',
      type: 'number',
      admin: {
        description:
          'Parent concept ID (integer FK into concepts). Direct ID edit; admin relationship picker disabled because concepts_rels is not provisioned.',
      },
    },
    {
      name: 'relatedConcepts',
      type: 'json',
      admin: { description: '[{concept_id, relationship: "relates_to"|"contrasts_with"|"component_of"|"measured_by"}]' },
    },
    {
      name: 'canonicalReference',
      type: 'text',
      admin: { description: 'Foundational citation if applicable' },
    },
    {
      name: 'externalIds',
      type: 'json',
      admin: { description: '{wikidata, wikipedia_url, mesh_id}' },
    },
    {
      name: 'mentionCount',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'publicationCount',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { readOnly: true },
    },
    flagsForItemField,
  ],
}
