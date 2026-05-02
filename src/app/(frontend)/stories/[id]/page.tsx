import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '../../lib/db'
import { isHttpUrl } from '../../lib/url-validation'
import FlagButton from '../../components/FlagButton'

export const dynamic = 'force-dynamic'

const STORY_TYPE_LABELS: Record<string, string> = {
  oral_history: 'Oral History', interview: 'Interview', press_release: 'Press Release',
  memoir: 'Memoir', field_notes: 'Field Notes', blog_post: 'Blog Post',
  event_coverage: 'Event Coverage', news_article: 'News Article', other: 'Story',
  research_summary: 'Research Summary', opinion_editorial: 'Opinion', feature: 'Feature',
  profile: 'Profile', obituary: 'Obituary', legislative: 'Legislative',
  scientific_paper: 'Scientific Paper',
}

const ENTITY_SLUG: Record<string, string> = {
  species: 'species', concept: 'concepts', protocol: 'protocols', place: 'places',
}
const ENTITY_LABEL: Record<string, string> = {
  species: 'Species', concept: 'Concepts', protocol: 'Protocols', place: 'Places', stakeholder: 'Stakeholders',
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

  const { rows: [story] } = await db.query(
    `SELECT id, title, story_type, author, date, summary, location, duration,
            media_url, media_type, source_url
     FROM stories WHERE id = $1`,
    [id],
  )
  if (!story) notFound()

  // Fetch entity mentions grouped by type
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

  // Find related stories via shared entities (at least 2 shared)
  const { rows: relatedStories } = entities.length > 0 ? await db.query(`
    WITH my_entities AS (
      SELECT entity_type, entity_id FROM entity_mentions
      WHERE collection = 'stories' AND item_id = $1
    )
    SELECT s.id, s.title, s.story_type, s.author, s.date, count(*) as shared
    FROM entity_mentions em
    JOIN my_entities me ON me.entity_type = em.entity_type AND me.entity_id = em.entity_id
    JOIN stories s ON s.id = em.item_id
    WHERE em.collection = 'stories' AND em.item_id != $1
    GROUP BY s.id, s.title, s.story_type, s.author, s.date
    HAVING count(*) >= 2
    ORDER BY count(*) DESC
    LIMIT 8
  `, [id]) : { rows: [] }

  // Find related publications via shared entities
  const { rows: relatedPubs } = entities.length > 0 ? await db.query(`
    WITH my_entities AS (
      SELECT entity_type, entity_id FROM entity_mentions
      WHERE collection = 'stories' AND item_id = $1
    )
    SELECT p.id, p.title, p.year, p.journal, count(*) as shared
    FROM entity_mentions em
    JOIN my_entities me ON me.entity_type = em.entity_type AND me.entity_id = em.entity_id
    JOIN publications p ON p.id = em.item_id
    WHERE em.collection = 'publications'
    GROUP BY p.id, p.title, p.year, p.journal
    HAVING count(*) >= 2
    ORDER BY count(*) DESC
    LIMIT 5
  `, [id]) : { rows: [] }

  // Fetch participants
  const { rows: participants } = await db.query(
    'SELECT name, role FROM stories_participants WHERE _parent_id = $1 ORDER BY _order',
    [id],
  )

  // Top entity chips for the header area
  const topEntities = entities.slice(0, 12)

  return (
    <div className="detail">
      <Link href="/stories" className="detail-back">&larr; Back to Stories</Link>

      <span className="badge badge-story">{STORY_TYPE_LABELS[story.story_type] || 'Story'}</span>
      <h1>{story.title}</h1>
      <FlagButton collection="stories" itemId={parseInt(id)} />

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
        {isHttpUrl(story.source_url) && !story.source_url.includes('advance.lexis.com') && (
          <div>
            <strong>Source:</strong>{' '}
            <a href={story.source_url} target="_blank" rel="noopener noreferrer">
              {new URL(story.source_url).hostname} &rarr;
            </a>
          </div>
        )}
      </div>

      {/* Top entity chips */}
      {topEntities.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '16px 0' }}>
          {topEntities.map((e: any) => {
            const slug = ENTITY_SLUG[e.entity_type]
            return slug ? (
              <Link key={`${e.entity_type}-${e.entity_id}`} href={`/${slug}/${e.entity_id}`} style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '12px', textDecoration: 'none',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                color: 'var(--fg-2)',
                fontStyle: e.entity_type === 'species' ? 'italic' : undefined,
              }}>
                {e.name}
              </Link>
            ) : (
              <span key={`${e.entity_type}-${e.entity_id}`} style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '12px',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                color: 'var(--fg-2)',
              }}>
                {e.name}
              </span>
            )
          })}
        </div>
      )}

      {story.summary && story.summary.length > 20 && (
        <div className="detail-section">
          <h2>Summary</h2>
          <p style={{ fontSize: '15px', lineHeight: 1.7, color: 'var(--fg-2)', maxWidth: '68ch' }}>{story.summary}</p>
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
          ) : story.media_type === 'video' && (story.media_url.includes('youtube.com') || story.media_url.includes('youtu.be')) ? (
            <iframe
              width="560" height="315"
              src={story.media_url.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')}
              frameBorder="0" allowFullScreen
              style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }}
            />
          ) : (
            <a href={story.media_url} target="_blank" rel="noopener noreferrer">View media &rarr;</a>
          )}
        </div>
      )}

      {/* Link to original source */}
      {isHttpUrl(story.source_url) && !story.source_url.includes('advance.lexis.com') && (
        <div className="detail-section">
          <a href={story.source_url} target="_blank" rel="noopener noreferrer"
             style={{ fontSize: '14px', color: 'var(--accent)' }}>
            Read full article at {new URL(story.source_url).hostname} &rarr;
          </a>
        </div>
      )}

      {/* Related stories */}
      {relatedStories.length > 0 && (
        <div className="detail-section">
          <h2>Related Stories</h2>
          <div className="result-cards">
            {relatedStories.map((s: any) => (
              <Link key={s.id} href={`/stories/${s.id}`} className="result-card">
                <div className="result-card-header">
                  <span className="badge badge-story">{STORY_TYPE_LABELS[s.story_type] || 'Story'}</span>
                  <h3 className="result-card-title">{s.title}</h3>
                </div>
                <div className="result-card-meta">
                  {s.author && <span>{s.author}</span>}
                  {s.date && <span>{new Date(s.date).getFullYear()}</span>}
                  <span>{s.shared} shared entities</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Related publications */}
      {relatedPubs.length > 0 && (
        <div className="detail-section">
          <h2>Related Publications</h2>
          <div className="result-cards">
            {relatedPubs.map((p: any) => (
              <Link key={p.id} href={`/publications/${p.id}`} className="result-card">
                <div className="result-card-header">
                  <span className="badge badge-publication">Publication</span>
                  <h3 className="result-card-title">{p.title}</h3>
                </div>
                <div className="result-card-meta">
                  {p.year && <span>{p.year}</span>}
                  {p.journal && <span>{p.journal}</span>}
                  <span>{p.shared} shared entities</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Entity mentions by type */}
      {[...entityGroups.entries()].map(([type, items]) => (
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
