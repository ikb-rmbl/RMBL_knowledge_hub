import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { isHttpUrl } from '../../lib/url-validation'

export const dynamic = 'force-dynamic'

const STORY_TYPE_LABELS: Record<string, string> = {
  oral_history: 'Oral History', interview: 'Interview', press_release: 'Press Release',
  memoir: 'Memoir', field_notes: 'Field Notes', blog_post: 'Blog Post',
  event_summary: 'Event Summary', news_article: 'News Article', other: 'Story',
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { rows: [s] } = await getDb().query('SELECT title, summary, story_type FROM stories WHERE id = $1', [id])
  if (!s) return { title: 'Story — RMBL Knowledge Hub' }
  const desc = s.summary ? String(s.summary).slice(0, 200) : `${STORY_TYPE_LABELS[s.story_type] || 'Story'} from the RMBL Knowledge Hub`
  return {
    title: `${s.title} — RMBL Knowledge Hub`,
    description: desc,
    openGraph: { title: s.title, description: desc, url: `https://rmblknowledgehub.org/stories/${id}` },
  }
}

export default async function StoryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const { rows: [story] } = await db.query('SELECT * FROM stories WHERE id = $1', [id])
  if (!story) notFound()

  // Fetch participants
  const { rows: participants } = await db.query(
    'SELECT name, role FROM stories_participants WHERE _parent_id = $1 ORDER BY _order',
    [id],
  )

  // Fetch entity mentions (if any have been extracted)
  const { rows: entities } = await db.query(`
    SELECT entity_type, entity_id,
      CASE entity_type
        WHEN 'species' THEN (SELECT canonical_name FROM species WHERE id = entity_id)
        WHEN 'concept' THEN (SELECT name FROM concepts WHERE id = entity_id)
        WHEN 'protocol' THEN (SELECT name FROM protocols WHERE id = entity_id)
        WHEN 'place' THEN (SELECT name FROM places WHERE id = entity_id)
        WHEN 'stakeholder' THEN (SELECT name FROM stakeholders WHERE id = entity_id)
      END as name
    FROM entity_mentions
    WHERE collection = 'stories' AND item_id = $1
    ORDER BY entity_type
  `, [id])

  const entityGroups = new Map<string, any[]>()
  for (const e of entities) {
    if (!e.name) continue
    if (!entityGroups.has(e.entity_type)) entityGroups.set(e.entity_type, [])
    entityGroups.get(e.entity_type)!.push(e)
  }

  const ENTITY_SLUG: Record<string, string> = {
    species: 'species', concept: 'concepts', protocol: 'protocols', place: 'places',
  }
  const ENTITY_LABEL: Record<string, string> = {
    species: 'Species', concept: 'Concepts', protocol: 'Protocols', place: 'Places', stakeholder: 'Stakeholders',
  }

  return (
    <div className="detail">
      <Link href="/stories" className="detail-back">&larr; Back to Stories</Link>

      <span className="badge badge-story">{STORY_TYPE_LABELS[story.story_type] || 'Story'}</span>
      <h1>{story.title}</h1>

      <div className="detail-meta">
        {story.author && <div><strong>By:</strong> {story.author}</div>}
        {story.date && (
          <div><strong>Date:</strong> {new Date(story.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        )}
        {story.location && <div><strong>Location:</strong> {story.location}</div>}
        {story.duration && <div><strong>Duration:</strong> {story.duration}</div>}
        {story.media_type && story.media_type !== 'text' && (
          <div><strong>Media:</strong> {story.media_type}</div>
        )}
        {participants.length > 0 && (
          <div>
            <strong>Participants:</strong>{' '}
            {participants.map((p: any, i: number) => (
              <span key={i}>{i > 0 && ', '}{p.name}{p.role ? ` (${p.role})` : ''}</span>
            ))}
          </div>
        )}
        {isHttpUrl(story.source_url) && (
          <div>
            <strong>Source:</strong>{' '}
            <a href={story.source_url} target="_blank" rel="noopener noreferrer">
              {new URL(story.source_url).hostname} &rarr;
            </a>
          </div>
        )}
      </div>

      {story.summary && (
        <div className="detail-section">
          <h2>Summary</h2>
          <p style={{ fontSize: '15px', lineHeight: 1.7, color: 'var(--fg-2)' }}>{story.summary}</p>
        </div>
      )}

      {/* Media embed */}
      {isHttpUrl(story.media_url) && (
        <div className="detail-section">
          <h2>Media</h2>
          {story.media_type === 'audio' ? (
            <audio controls src={story.media_url} style={{ width: '100%', maxWidth: '500px' }}>
              <a href={story.media_url}>Download audio</a>
            </audio>
          ) : story.media_type === 'video' ? (
            story.media_url.includes('youtube.com') || story.media_url.includes('youtu.be') ? (
              <iframe
                width="560" height="315"
                src={story.media_url.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')}
                frameBorder="0" allowFullScreen
                style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }}
              />
            ) : (
              <a href={story.media_url} target="_blank" rel="noopener noreferrer">View media &rarr;</a>
            )
          ) : (
            <a href={story.media_url} target="_blank" rel="noopener noreferrer">View media &rarr;</a>
          )}
        </div>
      )}

      {/* Full text */}
      {story.full_text && (
        <div className="detail-section">
          <h2>Full Text</h2>
          <div style={{ fontSize: '14px', lineHeight: 1.8, color: 'var(--fg-2)', maxWidth: '68ch' }}>
            {story.full_text.split(/\n\n+/).map((para: string, i: number) => (
              <p key={i} style={{ marginBottom: '12px' }}>{para}</p>
            ))}
          </div>
        </div>
      )}

      {/* Entity mentions */}
      {entityGroups.size > 0 && [...entityGroups.entries()].map(([type, items]) => (
        <div key={type} className="detail-section">
          <h2>{ENTITY_LABEL[type] || type} ({items.length})</h2>
          <div className="result-cards">
            {items.map((e: any) => {
              const slug = ENTITY_SLUG[type]
              return slug ? (
                <Link key={e.entity_id} href={`/${slug}/${e.entity_id}`} className="result-card">
                  <h3 className="result-card-title" style={type === 'species' ? { fontStyle: 'italic' } : undefined}>{e.name}</h3>
                </Link>
              ) : (
                <div key={e.entity_id} className="result-card" style={{ cursor: 'default' }}>
                  <h3 className="result-card-title">{e.name}</h3>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
