import type { CollectionConfig } from 'payload'
import { publicReadAuthWrite } from './shared/access'
import { tombstoneHookFor } from './shared/tombstoneHook'
import { flagsForItemField } from './shared/flagsField'

export const Stories: CollectionConfig = {
  slug: 'stories',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'storyType', 'author', 'date'],
    group: 'Content',
  },
  hooks: {
    beforeDelete: [tombstoneHookFor('stories')],
  },
  access: publicReadAuthWrite,
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'storyType',
      type: 'select',
      required: true,
      defaultValue: 'other',
      options: [
        { label: 'Oral History', value: 'oral_history' },
        { label: 'Interview', value: 'interview' },
        { label: 'Press Release', value: 'press_release' },
        { label: 'Memoir', value: 'memoir' },
        { label: 'Field Notes', value: 'field_notes' },
        { label: 'Blog Post', value: 'blog_post' },
        { label: 'Event Summary', value: 'event_summary' },
        { label: 'News Article', value: 'news_article' },
        { label: 'Other', value: 'other' },
      ],
    },
    {
      name: 'author',
      type: 'text',
      admin: {
        description: 'Writer, narrator, or primary voice',
      },
    },
    {
      name: 'date',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
        description: 'When the story was created or recorded',
      },
    },
    {
      name: 'summary',
      type: 'textarea',
      admin: {
        description: 'Short description of the story',
      },
    },
    {
      name: 'fullText',
      type: 'textarea',
      admin: {
        description: 'Full narrative text or transcript',
      },
    },
    {
      name: 'mediaUrl',
      type: 'text',
      admin: {
        description: 'Link to external audio or video file',
      },
    },
    {
      name: 'mediaType',
      type: 'select',
      options: [
        { label: 'Audio', value: 'audio' },
        { label: 'Video', value: 'video' },
        { label: 'Text', value: 'text' },
        { label: 'Mixed', value: 'mixed' },
      ],
      admin: {
        description: 'Primary media format',
      },
    },
    {
      name: 'sourceUrl',
      type: 'text',
      admin: {
        description: 'Original source URL (if scraped or linked)',
      },
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'topics',
      hasMany: true,
      admin: {
        description: 'Topics/themes',
      },
    },
    {
      name: 'duration',
      type: 'text',
      admin: {
        description: 'Length for audio/video (e.g., "45 min")',
      },
    },
    {
      name: 'participants',
      type: 'array',
      admin: {
        description: 'People featured in the story (interviewees, narrators)',
      },
      fields: [
        { name: 'name', type: 'text', required: true },
        {
          name: 'role',
          type: 'select',
          options: [
            { label: 'Narrator', value: 'narrator' },
            { label: 'Interviewee', value: 'interviewee' },
            { label: 'Interviewer', value: 'interviewer' },
            { label: 'Author', value: 'author' },
            { label: 'Subject', value: 'subject' },
            { label: 'Other', value: 'other' },
          ],
        },
      ],
    },
    {
      name: 'location',
      type: 'text',
      admin: {
        description: 'Where the story takes place (e.g., "Gothic, Colorado")',
      },
    },
    flagsForItemField,
  ],
}
