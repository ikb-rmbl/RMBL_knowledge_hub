import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'pi', 'projectType', 'status'],
    group: 'Content',
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Project or research plan name',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Non-technical abstract or project summary',
      },
    },
    {
      name: 'projectType',
      type: 'select',
      required: true,
      defaultValue: 'research_plan',
      options: [
        { label: 'Research Plan', value: 'research_plan' },
        { label: 'Program', value: 'program' },
        { label: 'Campaign', value: 'campaign' },
        { label: 'Initiative', value: 'initiative' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Completed', value: 'completed' },
        { label: 'Ongoing', value: 'ongoing' },
      ],
    },
    {
      name: 'pi',
      type: 'text',
      admin: {
        description: 'Principal Investigator name',
      },
    },
    {
      name: 'piAuthor',
      type: 'relationship',
      relationTo: 'authors',
      admin: {
        description: 'Link to PI author record',
      },
    },
    {
      name: 'fieldOfScience',
      type: 'text',
    },
    {
      name: 'researchAreas',
      type: 'textarea',
      admin: {
        description: 'Semicolon-separated research areas',
      },
    },
    {
      name: 'startYear',
      type: 'number',
    },
    {
      name: 'endYear',
      type: 'number',
    },
    // Linked items (auto-discovered + manually curated)
    {
      name: 'publications',
      type: 'relationship',
      relationTo: 'publications',
      hasMany: true,
    },
    {
      name: 'datasets',
      type: 'relationship',
      relationTo: 'datasets',
      hasMany: true,
    },
    {
      name: 'documents',
      type: 'relationship',
      relationTo: 'documents',
      hasMany: true,
    },
    {
      name: 'researchTopics',
      type: 'relationship',
      relationTo: 'topics',
      hasMany: true,
    },
    // Discovery configuration
    {
      name: 'parentProject',
      type: 'relationship',
      relationTo: 'projects',
      admin: {
        description: 'Parent program/campaign this research plan belongs to',
      },
    },
    {
      name: 'discoveryKeywords',
      type: 'textarea',
      admin: {
        description: 'Keywords/phrases for auto-discovery (one per line)',
        position: 'sidebar',
      },
    },
    {
      name: 'autoDiscoveryEnabled',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Automatically discover and assign items to this project',
      },
    },
  ],
}
