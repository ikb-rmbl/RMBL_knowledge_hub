/**
 * Assign publications to Topics taxonomy based on their keywords.
 *
 * Maps publication keywords to parent topic categories, then updates
 * each publication's researchTopics field in Payload via REST API.
 *
 * Usage:
 *   npx tsx scripts/assign-publication-topics.ts [--dry-run] [--limit=N]
 */

import { readFileSync } from 'fs'

const BASE_URL = 'http://localhost:3000'
const API = `${BASE_URL}/api`
const ADMIN_EMAIL = 'admin@rmbl.org'
const ADMIN_PASSWORD = 'dev-password-change-me'
const CONCURRENCY = 5

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity

// ---------------------------------------------------------------------------
// Keyword -> Parent Topic mapping
// ---------------------------------------------------------------------------

interface TopicRule {
  parent: string
  patterns: RegExp
}

const TOPIC_RULES: TopicRule[] = [
  {
    parent: 'Water & Hydrology',
    patterns: /\b(water|hydro|stream|river|aquatic|limnol|fish|amphibian|wetland|watershed|flood|snow|glacial|groundwater|discharge|riparian|trout|salmonid|macroinvertebrate)\b/i,
  },
  {
    parent: 'Ecology & Biology',
    patterns: /\b(ecolog|plant|animal|insect|bird|mammal|pollinat|flower|phenol|biodivers|habitat|vegetation|forest|tree|grass|alpine|meadow|subalpine|tundra|canopy|fung|microb|wildlife|fauna|flora|bee\b|butterfly|marmot|salamander|herbiv|predator|prey|population|community|mutualis|parasit|symbi|compet|trophic|food web|seed|pollen|nectar|nest|breed|migrat|invas|litter|decompos|biomass|productiv|diversity|richness|abundan|botan|entomol|ornithol|mammalogy|lepidoptera|foraging|grazing|reproduc|species|evolution|genetic|adaptation|selection|fitness|phenotype|genotype|morphol|behavior|courtship|mating)/i,
  },
  {
    parent: 'Climate & Atmosphere',
    patterns: /\b(climate|temperature|weather|atmospher|warm|cool|drought|snow water|carbon dioxide|co2|greenhouse|aerosol|radiation|solar|ozone|phenology.*climate|season|frost|freeze)\b/i,
  },
  {
    parent: 'Soil & Geology',
    patterns: /\b(soil|geolog|rock|sediment|mineral|erosion|geochemi|bedrock|weathering|geomorph|terrain|elevation|slope)\b/i,
  },
  {
    parent: 'Chemistry & Biogeochemistry',
    patterns: /\b(chemi|nutrient|nitrogen|phosphor|sulfur|metal|isotop|carbon cycle|biogeochem|decomposition rate|stoichiometr)\b/i,
  },
  {
    parent: 'Mining & Energy',
    patterns: /\b(mining|mine\b|molybdenum|uranium|energy|coal|fuel)\b/i,
  },
  {
    parent: 'Land Use & Community',
    patterns: /\b(land use|conserv|restor|manage|recreation|human|urban|ranch|livestock|cattle|disturbance.*human|fire.*management)\b/i,
  },
  {
    parent: 'Remote Sensing & GIS',
    patterns: /\b(remote sens|satellite|gis|spatial|ndvi|spectral|landsat|uav|drone|mapping)\b/i,
  },
  {
    parent: 'Methods & Data Management',
    patterns: /\b(method|statistic|model|experiment|sampl|monitor|survey|technique|protocol)\b/i,
  },
  {
    parent: 'Places & Projects',
    patterns: /\b(rmbl|gothic|crested butte|gunnison|east river|rocky mountain biological)\b/i,
  },
]

/**
 * Also assign based on title + journal when no keywords are available
 */
const JOURNAL_RULES: { parent: string; patterns: RegExp }[] = [
  { parent: 'Ecology & Biology', patterns: /ecology|evolution|biolog|botanical|zoolog|entomol|ornithol|mammal|animal behav|etholog|heredity|oecologia|oikos/i },
  { parent: 'Water & Hydrology', patterns: /freshwater|limnol|hydrol|fisheries|aquatic/i },
  { parent: 'Climate & Atmosphere', patterns: /climate|atmospher|meteorol|geophysical/i },
  { parent: 'Soil & Geology', patterns: /soil|geolog|geomorphol|geochemi/i },
  { parent: 'Chemistry & Biogeochemistry', patterns: /chemi|biogeochem/i },
  { parent: 'Land Use & Community', patterns: /conservation|wildlife manage|land/i },
]

function assignTopics(
  keywords: string[],
  title: string,
  journal: string | null,
): Set<string> {
  const assigned = new Set<string>()

  // Match keywords against topic rules
  const allKeywords = keywords.join(' ')
  for (const rule of TOPIC_RULES) {
    if (rule.patterns.test(allKeywords)) {
      assigned.add(rule.parent)
    }
  }

  // Also check title
  for (const rule of TOPIC_RULES) {
    if (rule.patterns.test(title)) {
      assigned.add(rule.parent)
    }
  }

  // If still nothing, try journal name
  if (assigned.size === 0 && journal) {
    for (const rule of JOURNAL_RULES) {
      if (rule.patterns.test(journal)) {
        assigned.add(rule.parent)
        break
      }
    }
  }

  // Remove "Places & Projects" if it was the only match (too generic)
  if (assigned.size === 1 && assigned.has('Places & Projects')) {
    // Keep it — rmbl-specific content is still useful
  }

  // Remove "Methods & Data Management" if something more specific was also matched
  if (assigned.size > 1 && assigned.has('Methods & Data Management')) {
    assigned.delete('Methods & Data Management')
  }

  return assigned
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

let authToken: string | null = null

async function login() {
  const res = await fetch(`${API}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const data = await res.json()
  authToken = data.token
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `JWT ${authToken}` } : {}),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Assign Publication Topics')
  console.log('=========================')
  if (dryRun) console.log('(DRY RUN)')

  await login()

  // Load normalized publications
  const OUTPUT_DIR = new URL('./output', import.meta.url).pathname
  const pubs: any[] = JSON.parse(readFileSync(`${OUTPUT_DIR}/publications-normalized.json`, 'utf-8'))

  // Load topic name -> ID mapping from Payload
  const topicIds = new Map<string, string>()
  let page = 1
  while (true) {
    const res = await fetch(`${API}/topics?limit=100&page=${page}`, { headers: headers() })
    const data = await res.json()
    for (const t of data.docs) {
      topicIds.set(t.name, String(t.id))
    }
    if (data.docs.length < 100) break
    page++
  }
  console.log(`Loaded ${topicIds.size} topic IDs`)

  // Load Payload publication IDs — map by title
  console.log('Loading publication records from Payload...')
  const payloadPubsByTitle = new Map<string, string>()
  page = 1
  while (true) {
    const res = await fetch(`${API}/publications?limit=500&page=${page}&depth=0`, { headers: headers() })
    const data = await res.json()
    const prevSize = payloadPubsByTitle.size
    for (const p of data.docs) {
      payloadPubsByTitle.set(p.title, String(p.id))
    }
    process.stdout.write(`\r  Loaded ${payloadPubsByTitle.size}...`)
    // Stop if no new records were added or we got fewer than a full page
    if (data.docs.length < 500 || payloadPubsByTitle.size === prevSize) break
    page++
  }
  console.log(`\r  ${payloadPubsByTitle.size} publications loaded from Payload`)

  // Assign topics
  let assigned = 0
  let noMatch = 0
  let notInPayload = 0
  let updated = 0
  const topicDistribution = new Map<string, number>()

  let candidates = pubs.slice(0, Math.min(pubs.length, limit))

  for (let i = 0; i < candidates.length; i++) {
    const pub = candidates[i]
    const keywords = (pub.keywords || []).map((k: any) => k.keyword)
    const topics = assignTopics(keywords, pub.title, pub.journal)

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

    // Find the Payload record
    const payloadId = payloadPubsByTitle.get(pub.title)
    if (!payloadId) {
      notInPayload++
      continue
    }

    // Update in Payload
    if (!dryRun) {
      const res = await fetch(`${API}/publications/${payloadId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ researchTopics: topicIdList }),
      })
      if (res.ok) updated++
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
  console.log(`Publications processed: ${candidates.length}`)
  console.log(`Assigned to topics:     ${assigned} (${(assigned / candidates.length * 100).toFixed(0)}%)`)
  console.log(`No topic match:         ${noMatch}`)
  console.log(`Not in Payload:         ${notInPayload}`)
  console.log(`Updated in Payload:     ${updated}`)

  console.log('\nTopic distribution:')
  for (const [name, count] of [...topicDistribution.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
