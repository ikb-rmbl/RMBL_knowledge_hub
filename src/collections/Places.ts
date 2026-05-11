import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { flagsForItemField } from './shared/flagsField'

const PLACE_TYPES = [
  { label: 'Study Site', value: 'study_site' },
  { label: 'Peak / Mountain', value: 'peak' },
  { label: 'Valley', value: 'valley' },
  { label: 'Watershed', value: 'watershed' },
  { label: 'Stream / River', value: 'stream' },
  { label: 'Lake / Pond', value: 'lake' },
  { label: 'Meadow', value: 'meadow' },
  { label: 'Town', value: 'town' },
  { label: 'County', value: 'county' },
  { label: 'State', value: 'state' },
  { label: 'Country', value: 'country' },
  { label: 'Region', value: 'region' },
  { label: 'Trail', value: 'trail' },
  { label: 'Named Point', value: 'named_point' },
  { label: 'Bioregion', value: 'bioregion' },
]

const PLACE_SCALES = [
  { label: 'Site (≤1 km²)', value: 'site' },
  { label: 'Local (1-100 km²)', value: 'local' },
  { label: 'Regional', value: 'regional' },
  { label: 'State', value: 'state' },
  { label: 'National', value: 'national' },
  { label: 'Continental', value: 'continental' },
]

export const Places: CollectionConfig = {
  slug: 'places',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'placeType', 'parentPlace', 'publicationCount'],
    group: 'Entities',
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Canonical place name' },
    },
    {
      name: 'placeType',
      type: 'select',
      options: PLACE_TYPES,
      index: true,
    },
    {
      name: 'scale',
      type: 'select',
      options: PLACE_SCALES,
    },
    {
      name: 'parentPlace',
      type: 'relationship',
      relationTo: 'places',
      admin: { description: 'Containing place (Gothic → Gunnison County → Colorado)' },
    },
    {
      name: 'lat',
      type: 'number',
      admin: { description: 'Latitude in decimal degrees', step: 0.000001 },
    },
    {
      name: 'lon',
      type: 'number',
      admin: { description: 'Longitude in decimal degrees', step: 0.000001 },
    },
    {
      name: 'boundingBox',
      type: 'json',
      admin: { description: '{north, south, east, west} in decimal degrees' },
    },
    {
      name: 'elevationM',
      type: 'number',
      admin: { description: 'Elevation in meters (single value)' },
    },
    {
      name: 'elevationMinM',
      type: 'number',
      admin: { description: 'Min elevation in meters (for ranges)' },
    },
    {
      name: 'elevationMaxM',
      type: 'number',
      admin: { description: 'Max elevation in meters (for ranges)' },
    },
    {
      name: 'areaKm2',
      type: 'number',
      admin: { description: 'Area in square kilometers' },
    },
    {
      name: 'habitatTypes',
      type: 'text',
      hasMany: true,
      admin: { description: 'subalpine meadow, riparian, alpine tundra, conifer forest, etc.' },
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'aliases',
      type: 'text',
      hasMany: true,
      admin: { description: 'Alternate names and abbreviations' },
    },
    {
      name: 'externalIds',
      type: 'json',
      admin: { description: '{geonames, osm_relation, gnis, wikidata}' },
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
