/**
 * Organize Topics Taxonomy
 *
 * Assigns all freeform topics to parent categories based on keyword matching.
 * Creates new parent categories as needed and updates existing topic records
 * in Payload via the REST API.
 *
 * Usage:
 *   npx tsx scripts/organize-topics.ts [--dry-run]
 */

import { ensureAuth, getAllPaginated, createRecord, patchRecord } from './lib/payload-client.js'

const dryRun = process.argv.includes('--dry-run')

// ---------------------------------------------------------------------------
// Parent categories and matching patterns
// ---------------------------------------------------------------------------

interface CategoryDef {
  name: string
  patterns: RegExp
}

const CATEGORIES: CategoryDef[] = [
  {
    name: 'Water & Hydrology',
    patterns: /water|river|stream|snow\b|precipitation|rain|runoff|watershed|flood|aquat|hydro|discharge|groundwater|moisture|ice\b|glacier|snowpack|snowmelt|wetland|lake|irrigation|drought|streamflow|baseflow|flow\b|fluvial|porewater|hyporheic/i,
  },
  {
    name: 'Climate & Atmosphere',
    patterns: /climate|weather|atmospher|wind|radiation|solar\b|warming|carbon dioxide|co2\b|methane|greenhouse|aerosol|cloud|humidity|barometric|vapor|temperature(?!.*soil)|air temp|air quality|particulate|dust|ozone|precipitation chem/i,
  },
  {
    name: 'Ecology & Biology',
    patterns: /ecolog|species|plant\b|animal|insect|bird\b|mammal|fish\b|pollinator|flower|phenolog|biodivers|habitat|vegetation|forest|tree\b|grass|alpine|meadow|subalpine|tundra|riparian|canopy|fungi|microb|organism|wildlife|fauna|flora|bee\b|butterfly|marmot|salamander|herbiv|predator|prey|popul|community|mutualis|parasit|symbi|compet|trophic|food web|seed|pollen|nectar|nest|breed|migrat|invasion|invasive|native|endanger|conserv|litter|decompos|biomass|productiv|diversity|richness|abund/i,
  },
  {
    name: 'Soil & Geology',
    patterns: /soil|geolog|rock\b|sediment|mineral|erosion|geochemi|bedrock|weathering|clay\b|sand\b|gravel|lithol|geomorph|terrain|topograph|elevation|slope|aspect|dem\b|lidar|subsurface|stratigraphy|shale|mancos|bulk density|grain size/i,
  },
  {
    name: 'Chemistry & Biogeochemistry',
    patterns: /chemi|nutrient|nitrogen|phosphor|sulfur|sulfate|metal\b|trace\b|isotop|anion|cation|ph\b|organic matter|dissolv|concentration|speciation|redox|ammoni|carbon(?!.*dioxide)|DOC\b|NPOC|biogeochem|SUVA|absorbance|spectroscop|mass spec|chromatog|titrat/i,
  },
  {
    name: 'Remote Sensing & GIS',
    patterns: /remote sens|satellite|aerial|imagery|lidar|gis\b|arcgis|raster|vector\b|spatial data|geospatial|ndvi|spectral|landsat|modis|uav\b|drone|photogramm|point cloud|hyperspectral|basemap|orthophoto|mapping/i,
  },
  {
    name: 'Mining & Energy',
    patterns: /mining|mine\b|mineral extract|molybdenum|uranium|energy|oil\b|gas\b|coal\b|power\b|electric|renew/i,
  },
  {
    name: 'Land Use & Community',
    patterns: /land.use|develop|planning|policy|govern|community|housing|waste|recycl|zoning|transport|recreation|tourism|education|public health|civic/i,
  },
  {
    name: 'Methods & Data Management',
    patterns: /method|model(?!.*elevation)|statistic|monitor|sensor|measur|sample|survey|experiment|analys|time.series|instrument|calibrat|dataset|database|csv\b|netcdf|geotiff|format|reporting|protocol|workflow|numerical|simulation|bayesian|regression|interpolat/i,
  },
  {
    name: 'Places & Projects',
    patterns: /rmbl|gothic|crested.butte|gunnison|east river|colorado|rocky mountain|upper gunnison|watershed function|SFA\b|SAIL\b|NEON\b|LTER\b|ess.dive|dataone|EDI\b/i,
  },
]

// Topics that should stay as-is (already good parent topics from the spec)
const EXISTING_PARENTS_TO_MERGE: Record<string, string> = {
  'Water': 'Water & Hydrology',
  'Climate': 'Climate & Atmosphere',
  'Ecology': 'Ecology & Biology',
  'Geology': 'Soil & Geology',
  'Mining': 'Mining & Energy',
  'Energy': 'Mining & Energy',
  'Land Use': 'Land Use & Community',
  'Community': 'Land Use & Community',
  'Other': 'Other',
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
  return patchRecord('topics', topicId, { parent: parentId })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
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

  for (const cat of CATEGORIES) {
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
    for (const cat of CATEGORIES) {
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

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
