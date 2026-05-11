import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { curatedFieldsField, curationHookFor } from './shared/curationHook'
import { curatedFieldsWidget } from './shared/curationWidgetField'
import { CURATABLE_FIELDS } from './shared/curatableFields'
import { flagsForItemField } from './shared/flagsField'

const DATA_FORMAT_OPTIONS = [
  { label: 'CSV', value: 'csv' },
  { label: 'GeoTIFF', value: 'geotiff' },
  { label: 'NetCDF', value: 'netcdf' },
  { label: 'Shapefile', value: 'shapefile' },
  { label: 'GeoJSON', value: 'geojson' },
  { label: 'JSON', value: 'json' },
  { label: 'Excel', value: 'excel' },
  { label: 'HDF5', value: 'hdf5' },
  { label: 'Other', value: 'other' },
]

const REPOSITORY_OPTIONS = [
  { label: 'S3', value: 's3' },
  { label: 'ESS-DIVE', value: 'ess_dive' },
  { label: 'Other', value: 'other' },
]

const RESOURCE_TYPE_OPTIONS = [
  { label: 'Dataset', value: 'dataset' },
  { label: 'Software', value: 'software' },
  { label: 'Collection', value: 'collection' },
  { label: 'Service', value: 'service' },
  { label: 'Other', value: 'other' },
]

const LICENSE_OPTIONS = [
  { label: 'CC-BY 4.0', value: 'cc_by_4' },
  { label: 'CC-BY-SA 4.0', value: 'cc_by_sa_4' },
  { label: 'CC-BY-NC 4.0', value: 'cc_by_nc_4' },
  { label: 'CC0 1.0', value: 'cc0' },
  { label: 'MIT', value: 'mit' },
  { label: 'Other', value: 'other' },
]

export const Datasets: CollectionConfig = {
  slug: 'datasets',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'publicationYear', 'resourceType'],
    group: 'Content',
  },
  hooks: {
    beforeChange: [curationHookFor(CURATABLE_FIELDS.datasets)],
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: {
        description: 'DataCite: titles[0].title (Mandatory)',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'DataCite: descriptions[0].description',
      },
    },
    {
      name: 'creators',
      type: 'array',
      required: true,
      minRows: 1,
      admin: {
        description: 'DataCite: creators[] (Mandatory)',
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          admin: { width: '40%' },
        },
        {
          name: 'orcid',
          type: 'text',
          admin: { width: '30%' },
        },
        {
          name: 'affiliation',
          type: 'text',
          admin: { width: '30%' },
        },
      ],
    },
    {
      name: 'datePublished',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
        description: 'DataCite: dates[] (type: Issued)',
      },
    },
    {
      name: 'publicationYear',
      type: 'number',
      required: true,
      admin: {
        description: 'DataCite: publicationYear (Mandatory)',
      },
    },
    {
      name: 'spatialExtent',
      type: 'json',
      admin: {
        description: 'GeoJSON bounding box (DataCite: geoLocations[].geoLocationBox)',
      },
    },
    {
      name: 'temporalExtent',
      type: 'group',
      admin: {
        description: 'Data collection period (DataCite: dates[] type: Collected)',
      },
      fields: [
        {
          name: 'start',
          type: 'date',
          admin: {
            date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
          },
        },
        {
          name: 'end',
          type: 'date',
          admin: {
            date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
          },
        },
      ],
    },
    {
      name: 'dataFormat',
      type: 'select',
      hasMany: true,
      options: DATA_FORMAT_OPTIONS,
      admin: {
        description: 'DataCite: formats[]',
      },
    },
    {
      name: 'downloadUrl',
      type: 'text',
      admin: {
        description: 'Direct download link (S3 or external)',
      },
    },
    {
      name: 'doi',
      type: 'text',
      admin: {
        description: 'DataCite DOI (Mandatory if exists)',
      },
    },
    {
      name: 'repository',
      type: 'select',
      options: REPOSITORY_OPTIONS,
    },
    {
      name: 'externalCatalogUrl',
      type: 'text',
      admin: {
        description: 'Link to record on external catalog (e.g., ESS-DIVE landing page)',
      },
    },
    {
      name: 'spatialDescription',
      type: 'text',
      admin: {
        description: 'Human-readable place name (DataCite: geoLocations[].geoLocationPlace)',
      },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'topics',
      hasMany: true,
      admin: {
        description: 'Shared taxonomy (DataCite: subjects[])',
      },
    },
    {
      name: 'relatedPublications',
      type: 'relationship',
      relationTo: 'publications',
      hasMany: true,
      admin: {
        description: 'DataCite: relatedIdentifiers[]',
      },
    },
    {
      name: 'license',
      type: 'select',
      options: LICENSE_OPTIONS,
      admin: {
        description: 'DataCite: rightsList[]',
      },
    },
    {
      name: 'fileSize',
      type: 'text',
      admin: {
        description: 'Human-readable file size (DataCite: sizes[])',
      },
    },
    {
      name: 'resourceType',
      type: 'select',
      required: true,
      options: RESOURCE_TYPE_OPTIONS,
      admin: {
        description: 'DataCite: resourceType (Mandatory)',
      },
    },
    {
      name: 'dataPublisher',
      type: 'text',
      required: true,
      defaultValue: 'RMBL',
      admin: {
        description: 'DataCite: publisher (Mandatory)',
      },
    },
    {
      name: 'methods',
      type: 'textarea',
      admin: {
        description: 'Methods description extracted from metadata',
        condition: (_, siblingData) => Boolean(siblingData?.methods),
      },
    },
    {
      name: 'fullText',
      type: 'textarea',
      admin: {
        description: 'Full metadata text extracted from external sources; used for search indexing',
        condition: (_, siblingData) => Boolean(siblingData?.fullText),
      },
    },
    flagsForItemField,
    curatedFieldsField,
    curatedFieldsWidget,
  ],
}
