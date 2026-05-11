import type { CollectionConfig } from 'payload'
import { isAuthenticated } from './shared/access'

/**
 * Curation flags. Backed by the pre-existing `content_flags` table (created
 * by scripts/sql/add-content-flags.sql, extended with updated_at by
 * scripts/sql/add-flags-updated-at.sql).
 *
 * - Anonymous reads via POST `/api/v1/flags` (the public submission endpoint)
 *   still write directly to this table; that path is unchanged.
 * - Admin reads/edits use the Payload REST/Local API on this collection,
 *   gated by isAuthenticated.
 */
export const Flags: CollectionConfig = {
  slug: 'content-flags',
  dbName: 'content_flags',
  labels: {
    singular: 'Flag',
    plural: 'Flags',
  },
  admin: {
    group: 'Curation',
    useAsTitle: 'itemTitle',
    defaultColumns: ['itemTitle', 'collection', 'reason', 'status', 'createdAt'],
    description: 'Community-submitted curation reports. Filter by status to triage open issues.',
  },
  hooks: {
    beforeChange: [
      ({ data, req }) => {
        // When an admin moves a flag to a terminal state, stamp it with the
        // current time + current user unless they've explicitly set those.
        const terminal = data.status === 'resolved' || data.status === 'rejected'
        if (terminal) {
          if (!data.resolvedAt) data.resolvedAt = new Date().toISOString()
          if (!data.resolvedBy && req.user?.id) data.resolvedBy = req.user.id
        }
        return data
      },
    ],
  },
  access: {
    read: isAuthenticated,
    create: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  fields: [
    {
      name: 'collection',
      type: 'select',
      required: true,
      options: [
        { label: 'Publication', value: 'publications' },
        { label: 'Document', value: 'documents' },
        { label: 'Dataset', value: 'datasets' },
        { label: 'Story', value: 'stories' },
        { label: 'Author', value: 'authors' },
        { label: 'Species', value: 'species' },
        { label: 'Concept', value: 'concepts' },
        { label: 'Protocol', value: 'protocols' },
        { label: 'Place', value: 'places' },
        { label: 'Neighborhood', value: 'neighborhoods' },
      ],
      admin: { description: 'Which collection the flagged item belongs to.' },
    },
    {
      name: 'itemId',
      type: 'number',
      required: true,
      admin: { description: 'Numeric ID of the flagged item within its collection.' },
    },
    {
      name: 'itemTitle',
      type: 'text',
      admin: { description: 'Snapshot of the item title at submission time.' },
    },
    {
      name: 'reason',
      type: 'select',
      required: true,
      options: [
        { label: 'Incorrect data', value: 'incorrect_data' },
        { label: 'Duplicate', value: 'duplicate' },
        { label: 'Missing information', value: 'missing_info' },
        { label: 'Outdated', value: 'outdated' },
        { label: 'Inappropriate content', value: 'inappropriate' },
        { label: 'Broken link', value: 'broken_link' },
        { label: 'Other', value: 'other' },
      ],
    },
    {
      name: 'description',
      type: 'textarea',
      admin: { description: 'Reporter description of the problem.' },
    },
    {
      name: 'suggestion',
      type: 'textarea',
      admin: { description: 'Reporter suggestion for resolution.' },
    },
    {
      name: 'reporterEmail',
      type: 'text',
      admin: { description: 'Optional reporter contact email.' },
    },
    {
      name: 'reporterIp',
      type: 'text',
      admin: {
        description: 'Submitter IP (for rate-limit and duplicate detection).',
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'In review', value: 'in_review' },
        { label: 'Resolved', value: 'resolved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'resolutionNotes',
      type: 'textarea',
      admin: { description: 'Internal notes about how this was handled.' },
    },
    {
      name: 'resolvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        description: 'Auto-filled with the current user when status is set to Resolved or Rejected.',
      },
    },
    {
      name: 'resolvedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Auto-filled with the current time when status is set to Resolved or Rejected.',
      },
    },
  ],
}
