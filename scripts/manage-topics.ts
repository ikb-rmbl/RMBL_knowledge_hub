/**
 * Manage Topics — Unified topic taxonomy management
 *
 * Combines topic organization (creating parent categories, assigning freeform
 * topics to parents) and publication topic assignment (mapping keywords to
 * topic categories and updating publications in Payload).
 *
 * Usage:
 *   npx tsx scripts/manage-topics.ts                     # run both steps
 *   npx tsx scripts/manage-topics.ts --organize-only      # organize taxonomy only
 *   npx tsx scripts/manage-topics.ts --assign-only        # assign publication topics only
 *   npx tsx scripts/manage-topics.ts --dry-run            # preview changes
 *   npx tsx scripts/manage-topics.ts --limit=100          # limit publications processed
 */

import { readFileSync, readdirSync } from 'fs'
import { OUTPUT_DIR } from './lib/config.js'
import { ensureAuth, getAllPaginated, createRecord, patchRecord } from './lib/payload-client.js'
import {
  TOPIC_CATEGORIES,
  EXISTING_PARENTS_TO_MERGE,
  assignPublicationTopics,
  matchTopicCategories,
} from './lib/topic-rules.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManageTopicsOpts {
  dryRun: boolean
  limit?: number
}

// ---------------------------------------------------------------------------
// API helpers (thin wrappers around shared payload-client)
// ---------------------------------------------------------------------------

async function createTopic(name: string, parentId?: string): Promise<string | null> {
  const body: Record<string, unknown> = { name }
  if (parentId) body.parent = parentId
  const result = await createRecord('topics', body)
  return result?.id || null
}

async function updateTopicParent(topicId: string, parentId: string): Promise<boolean> {
  return patchRecord('topics', topicId, { parent: parentId }, { pipeline: true })
}

// ---------------------------------------------------------------------------
// organizeTopics — create parent categories and assign freeform topics
// ---------------------------------------------------------------------------

export async function organizeTopics(opts: ManageTopicsOpts): Promise<void> {
  const { dryRun } = opts

  console.log('Topic Taxonomy Organizer')
  console.log('========================')
  if (dryRun) console.log('(DRY RUN — no changes)')

  await ensureAuth()
  console.log('\nFetching all topics...')
  const topics = await getAllPaginated('topics')
  console.log(`  ${topics.length} topics loaded`)

  // Identify existing parent topics
  const existingByName = new Map(topics.map((t: any) => [t.name, t]))
  const topicsWithParent = topics.filter((t: any) => t.parent)
  const topicsWithoutParent = topics.filter((t: any) => !t.parent)

  console.log(`  ${topicsWithParent.length} already have a parent`)
  console.log(`  ${topicsWithoutParent.length} need assignment`)

  // Step 1: Create new parent categories
  console.log('\nStep 1: Creating parent categories...')
  const parentIds = new Map<string, string>()

  for (const cat of TOPIC_CATEGORIES) {
    const existing = existingByName.get(cat.name)
    if (existing) {
      parentIds.set(cat.name, existing.id)
      console.log(`  ${cat.name}: exists (${existing.id})`)
    } else if (!dryRun) {
      const id = await createTopic(cat.name)
      if (id) {
        parentIds.set(cat.name, id)
        console.log(`  ${cat.name}: created (${id})`)
      }
    } else {
      console.log(`  ${cat.name}: would create`)
    }
  }

  // Ensure "Other" parent exists
  if (!parentIds.has('Other')) {
    const other = existingByName.get('Other')
    if (other) parentIds.set('Other', other.id)
  }

  // Step 2: Reassign old spec parents as children of new parents
  console.log('\nStep 2: Reassigning old spec topics...')
  for (const [oldName, newParentName] of Object.entries(EXISTING_PARENTS_TO_MERGE)) {
    const oldTopic = existingByName.get(oldName)
    const newParentId = parentIds.get(newParentName)
    if (oldTopic && newParentId && oldTopic.id !== newParentId && !oldTopic.parent) {
      if (!dryRun) {
        await updateTopicParent(oldTopic.id, newParentId)
      }
      console.log(`  ${oldName} -> child of ${newParentName}`)
    }
  }

  // Step 3: Assign freeform topics to categories
  console.log('\nStep 3: Assigning freeform topics to categories...')
  const assignments = new Map<string, number>()
  let assigned = 0
  let unassigned = 0

  for (const topic of topicsWithoutParent) {
    // Skip if it's one of the new parent categories
    if ([...parentIds.values()].includes(topic.id)) continue
    // Skip if it's an old spec parent that we just reassigned
    if (Object.keys(EXISTING_PARENTS_TO_MERGE).includes(topic.name)) continue

    let matched = false
    for (const cat of TOPIC_CATEGORIES) {
      if (cat.patterns.test(topic.name)) {
        const parentId = parentIds.get(cat.name)
        if (parentId) {
          if (!dryRun) {
            await updateTopicParent(topic.id, parentId)
          }
          assignments.set(cat.name, (assignments.get(cat.name) || 0) + 1)
          assigned++
          matched = true
          break
        }
      }
    }

    if (!matched) {
      // Assign to "Other"
      const otherId = parentIds.get('Other')
      if (otherId && !dryRun) {
        await updateTopicParent(topic.id, otherId)
      }
      assignments.set('Other', (assignments.get('Other') || 0) + 1)
      unassigned++
    }

    if ((assigned + unassigned) % 50 === 0) {
      process.stdout.write(`\r  Processed ${assigned + unassigned} topics...`)
    }
  }
  console.log(`\r  Processed ${assigned + unassigned} topics`)

  // Summary
  console.log('\n========== Summary ==========')
  console.log(`Assigned to categories: ${assigned}`)
  console.log(`Assigned to Other: ${unassigned}`)
  console.log('\nBy category:')
  for (const [cat, count] of [...assignments.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`)
  }
}

// ---------------------------------------------------------------------------
// assignTopicsToPublications — map keywords to topics and update publications
// ---------------------------------------------------------------------------

export async function assignTopicsToPublications(opts: ManageTopicsOpts): Promise<void> {
  const { dryRun, limit: rawLimit } = opts
  const limit = rawLimit ?? Infinity

  console.log('Assign Publication Topics')
  console.log('=========================')
  if (dryRun) console.log('(DRY RUN)')

  await ensureAuth()

  // Load topic name -> ID mapping from Payload
  const topicDocs = await getAllPaginated('topics')
  const topicIds = new Map<string, string>()
  for (const t of topicDocs) {
    topicIds.set(t.name, String(t.id))
  }
  console.log(`Loaded ${topicIds.size} topic IDs`)

  // Load ALL publications from Payload — process those without topics assigned
  console.log('Loading publication records from Payload...')
  const pubDocs = await getAllPaginated('publications')
  const withTopics = pubDocs.filter((p: any) => p.researchTopics?.length > 0)
  const withoutTopics = pubDocs.filter((p: any) => !p.researchTopics || p.researchTopics.length === 0)
  console.log(`  ${pubDocs.length} total, ${withTopics.length} already have topics, ${withoutTopics.length} need assignment`)

  // Build a keyword lookup from normalized files (original + discovered)
  const keywordsByTitle = new Map<string, string[]>()
  const journalByTitle = new Map<string, string>()

  const normalizedPath = `${OUTPUT_DIR}/publications-normalized.json`
  const allNormalized: any[] = JSON.parse(readFileSync(normalizedPath, 'utf-8'))

  // Also load discovered publication files
  const discoveredFiles = readdirSync(OUTPUT_DIR).filter(
    (f) => f.startsWith('publications-discovered-') && f.endsWith('.json'),
  )
  for (const file of discoveredFiles) {
    const discovered = JSON.parse(readFileSync(`${OUTPUT_DIR}/${file}`, 'utf-8'))
    allNormalized.push(...discovered)
  }

  for (const pub of allNormalized) {
    const keywords = (pub.keywords || []).map((k: any) => k.keyword).filter(Boolean)
    if (keywords.length > 0) keywordsByTitle.set(pub.title, keywords)
    if (pub.journal) journalByTitle.set(pub.title, pub.journal)
  }
  console.log(`  Keyword data for ${keywordsByTitle.size} publications from normalized files`)

  // Process all publications — assign topics to those without, skip those that already have them
  let assigned = 0
  let noMatch = 0
  let alreadyAssigned = withTopics.length
  let updated = 0
  const topicDistribution = new Map<string, number>()

  const candidates = withoutTopics.slice(0, Math.min(withoutTopics.length, limit))

  for (let i = 0; i < candidates.length; i++) {
    const pub = candidates[i]
    const title = pub.title || ''

    // Get keywords from normalized data, or use empty array
    const keywords = keywordsByTitle.get(title) || []
    const journal = journalByTitle.get(title) || pub.journal || null
    const topics = assignPublicationTopics(keywords, title, journal)

    if (topics.size === 0) {
      noMatch++
      continue
    }

    assigned++
    for (const t of topics) {
      topicDistribution.set(t, (topicDistribution.get(t) || 0) + 1)
    }

    // Resolve topic names to IDs (as numbers for Payload)
    const topicIdList = [...topics].map((name) => topicIds.get(name)).filter(Boolean).map(Number)
    if (topicIdList.length === 0) continue

    // Update in Payload
    if (!dryRun) {
      const ok = await patchRecord('publications', String(pub.id), { researchTopics: topicIdList }, { pipeline: true })
      if (ok) updated++
    } else {
      updated++
    }

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  ${i + 1}/${candidates.length} processed, ${updated} updated`)
    }
  }
  console.log(`\r  ${candidates.length}/${candidates.length} processed, ${updated} updated`)

  // Summary
  console.log('\n========== Summary ==========')
  console.log(`Total publications:     ${pubDocs.length}`)
  console.log(`Already had topics:     ${alreadyAssigned}`)
  console.log(`Processed (no topics):  ${candidates.length}`)
  console.log(`Assigned to topics:     ${assigned} (${candidates.length > 0 ? (assigned / candidates.length * 100).toFixed(0) : 0}%)`)
  console.log(`No topic match:         ${noMatch}`)
  console.log(`Updated in Payload:     ${updated}`)

  console.log('\nTopic distribution:')
  for (const [name, count] of [...topicDistribution.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`)
  }
}

// ---------------------------------------------------------------------------
// assignTopicsToDocumentsAndDatasets — match titles/descriptions to thematic topics
// ---------------------------------------------------------------------------

export async function assignTopicsToDocumentsAndDatasets(opts: ManageTopicsOpts): Promise<void> {
  const { dryRun } = opts

  console.log('Assign Topics to Documents & Datasets')
  console.log('======================================')
  if (dryRun) console.log('(DRY RUN)')

  await ensureAuth()

  // Load topic name -> ID mapping
  const topicDocs = await getAllPaginated('topics')
  const topicIds = new Map<string, string>()
  for (const t of topicDocs) {
    topicIds.set(t.name, String(t.id))
  }

  // --- Documents ---
  console.log('\n--- Documents ---')
  const allDocs = await getAllPaginated('documents')
  let docUpdated = 0
  let docNoMatch = 0
  const docTopicDist = new Map<string, number>()

  for (let i = 0; i < allDocs.length; i++) {
    const doc = allDocs[i]
    const text = `${doc.title || ''} ${typeof doc.summary === 'string' ? doc.summary : ''}`
    const matches = matchTopicCategories(text)

    if (matches.length === 0) {
      docNoMatch++
      continue
    }

    const topicIdList = matches.map((name) => topicIds.get(name)).filter(Boolean).map(Number)
    if (topicIdList.length === 0) continue

    // Merge with existing category assignments (don't replace, add)
    const existingTopics = Array.isArray(doc.categories)
      ? doc.categories.map((c: any) => typeof c === 'number' ? c : c?.id).filter(Boolean).map(Number)
      : []
    const merged = [...new Set([...existingTopics, ...topicIdList])]

    if (merged.length > existingTopics.length) {
      if (!dryRun) {
        await patchRecord('documents', String(doc.id), { categories: merged }, { pipeline: true })
      }
      docUpdated++
      for (const m of matches) docTopicDist.set(m, (docTopicDist.get(m) || 0) + 1)
    }

    if ((i + 1) % 200 === 0) process.stdout.write(`\r  ${i + 1}/${allDocs.length}`)
  }
  console.log(`\r  ${allDocs.length} documents: ${docUpdated} updated, ${docNoMatch} no match`)
  if (docTopicDist.size > 0) {
    console.log('  Top topics:')
    for (const [name, count] of [...docTopicDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${name}: ${count}`)
    }
  }

  // --- Datasets ---
  console.log('\n--- Datasets ---')
  const allDatasets = await getAllPaginated('datasets')
  let dsUpdated = 0
  let dsNoMatch = 0
  const dsTopicDist = new Map<string, number>()

  for (let i = 0; i < allDatasets.length; i++) {
    const ds = allDatasets[i]
    const text = `${ds.title || ''} ${typeof ds.description === 'string' ? ds.description : ''} ${ds.spatialDescription || ''}`
    const matches = matchTopicCategories(text)

    if (matches.length === 0) {
      dsNoMatch++
      continue
    }

    const topicIdList = matches.map((name) => topicIds.get(name)).filter(Boolean).map(Number)
    if (topicIdList.length === 0) continue

    // Merge with existing tag assignments
    const existingTags = Array.isArray(ds.tags)
      ? ds.tags.map((t: any) => typeof t === 'number' ? t : t?.id).filter(Boolean).map(Number)
      : []
    const merged = [...new Set([...existingTags, ...topicIdList])]

    if (merged.length > existingTags.length) {
      if (!dryRun) {
        await patchRecord('datasets', String(ds.id), { tags: merged }, { pipeline: true })
      }
      dsUpdated++
      for (const m of matches) dsTopicDist.set(m, (dsTopicDist.get(m) || 0) + 1)
    }

    if ((i + 1) % 200 === 0) process.stdout.write(`\r  ${i + 1}/${allDatasets.length}`)
  }
  console.log(`\r  ${allDatasets.length} datasets: ${dsUpdated} updated, ${dsNoMatch} no match`)
  if (dsTopicDist.size > 0) {
    console.log('  Top topics:')
    for (const [name, count] of [...dsTopicDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${name}: ${count}`)
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const organizeOnly = args.includes('--organize-only')
  const assignOnly = args.includes('--assign-only')
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
  const limit = limitArg ? parseInt(limitArg) : undefined

  const opts: ManageTopicsOpts = { dryRun, limit }

  if (organizeOnly && assignOnly) {
    console.error('Cannot use both --organize-only and --assign-only')
    process.exit(1)
  }

  const runOrganize = !assignOnly
  const runAssign = !organizeOnly

  if (runOrganize) {
    await organizeTopics(opts)
    if (runAssign) console.log('\n')
  }

  if (runAssign) {
    await assignTopicsToPublications(opts)
    console.log('\n')
    await assignTopicsToDocumentsAndDatasets(opts)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
