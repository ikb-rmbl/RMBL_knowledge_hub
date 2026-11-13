import { describe, it, expect } from 'vitest'
import { matchTopicCategories, assignPublicationTopics, TOPIC_CATEGORIES, EXISTING_PARENTS_TO_MERGE, PARENT_TOPIC_NAMES, getTopicGroups } from '../lib/topic-rules.js'

describe('matchTopicCategories', () => {
  it('matches flowering & pollination text', () => {
    expect(matchTopicCategories('hummingbird pollination of Ipomopsis')).toContain('Flowering & Pollination')
  })

  it('matches wildlife behavior text', () => {
    expect(matchTopicCategories('marmot alarm calls and predation')).toContain('Wildlife Behavior')
  })

  it('matches alpine ecology text', () => {
    expect(matchTopicCategories('alpine meadow communities along elevational gradient')).toContain('Alpine & Subalpine Ecology')
  })

  it('matches forest ecology text', () => {
    expect(matchTopicCategories('aspen stand dynamics and conifer encroachment')).toContain('Forest Ecology')
  })

  it('matches freshwater ecology text', () => {
    expect(matchTopicCategories('stonefly predation on mayfly larvae in streams')).toContain('Freshwater Ecology')
  })

  it('matches hydrology text', () => {
    expect(matchTopicCategories('streamflow and watershed runoff')).toContain('Hydrology & Watersheds')
  })

  it('matches snow text', () => {
    expect(matchTopicCategories('snowpack dynamics and snowmelt')).toContain('Snow & Ice')
  })

  it('matches climate change text', () => {
    expect(matchTopicCategories('climate change impacts on phenological shifts')).toContain('Climate Change Impacts')
  })

  it('matches geology text', () => {
    expect(matchTopicCategories('volcanic stratigraphy and tectonic uplift')).toContain('Geology & Tectonics')
  })

  it('matches mining text', () => {
    expect(matchTopicCategories('molybdenum mining and ore deposits')).toContain('Mining & Mineral Resources')
  })

  it('matches archaeology text', () => {
    expect(matchTopicCategories('Folsom projectile points and paleo-indian sites')).toContain('Archaeology & Cultural History')
  })

  it('matches RMBL text', () => {
    expect(matchTopicCategories('Rocky Mountain Biological Laboratory field studies')).toContain('RMBL & Gothic')
  })

  it('matches science education text', () => {
    expect(matchTopicCategories('science education and STEM pedagogy')).toContain('Science Education & Pedagogy')
  })

  it('matches mentoring text', () => {
    expect(matchTopicCategories('REU undergraduate research training program')).toContain('Mentoring & Research Training')
  })

  it('returns multiple matches for cross-disciplinary text', () => {
    const matches = matchTopicCategories('soil carbon response to climate warming in alpine meadow')
    expect(matches).toContain('Soil Science')
    expect(matches).toContain('Alpine & Subalpine Ecology')
  })

  it('returns empty array for unrelated text', () => {
    expect(matchTopicCategories('quantum computing algorithms')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(matchTopicCategories('WATERSHED')).toContain('Hydrology & Watersheds')
  })
})

describe('assignPublicationTopics', () => {
  it('assigns from keywords', () => {
    const topics = assignPublicationTopics(['marmot', 'alarm call'], 'Some title', null)
    expect(topics.has('Wildlife Behavior')).toBe(true)
  })

  it('assigns from title when keywords match nothing', () => {
    const topics = assignPublicationTopics([], 'Snowpack dynamics in the upper watershed', null)
    expect(topics.has('Snow & Ice')).toBe(true)
  })

  it('falls back to journal name', () => {
    const topics = assignPublicationTopics([], 'A generic title', 'Journal of Ecology')
    expect(topics.size).toBeGreaterThan(0)
  })

  it('returns empty set for unrelated content', () => {
    const topics = assignPublicationTopics([], 'Quantum computing paper', null)
    expect(topics.size).toBe(0)
  })

  it('assigns multiple topics for cross-disciplinary work', () => {
    const topics = assignPublicationTopics(['pollination biology', 'alpine'], 'Flower visitation in subalpine meadows', null)
    expect(topics.has('Flowering & Pollination')).toBe(true)
    expect(topics.has('Alpine & Subalpine Ecology')).toBe(true)
  })
})

describe('TOPIC_CATEGORIES', () => {
  it('has 47 categories', () => {
    expect(TOPIC_CATEGORIES).toHaveLength(47)
  })

  it('all categories have name, group, and patterns', () => {
    for (const cat of TOPIC_CATEGORIES) {
      expect(cat.name).toBeTruthy()
      expect(cat.group).toBeTruthy()
      expect(cat.patterns).toBeInstanceOf(RegExp)
    }
  })
})

describe('PARENT_TOPIC_NAMES', () => {
  it('has 47 entries', () => {
    expect(PARENT_TOPIC_NAMES).toHaveLength(47)
  })

  it('includes key topics', () => {
    expect(PARENT_TOPIC_NAMES).toContain('Flowering & Pollination')
    expect(PARENT_TOPIC_NAMES).toContain('RMBL & Gothic')
    expect(PARENT_TOPIC_NAMES).toContain('Science Education & Pedagogy')
  })
})

describe('getTopicGroups', () => {
  it('returns 8 groups', () => {
    expect(getTopicGroups()).toHaveLength(8)
  })

  it('includes RMBL Institutional with the 7 legacy-website topics', () => {
    const inst = getTopicGroups().find((g) => g.group === 'RMBL Institutional')
    expect(inst?.topics).toHaveLength(7)
    expect(inst?.topics).toContain('Species Checklists & Identification Keys')
  })

  it('includes Life Sciences with 12 topics', () => {
    const groups = getTopicGroups()
    const life = groups.find((g) => g.group === 'Life Sciences')
    expect(life).toBeDefined()
    expect(life!.topics).toHaveLength(12)
  })
})

describe('EXISTING_PARENTS_TO_MERGE', () => {
  it('maps old parent names to new parent names', () => {
    expect(EXISTING_PARENTS_TO_MERGE['Water & Hydrology']).toBe('Hydrology & Watersheds')
    expect(EXISTING_PARENTS_TO_MERGE['Climate & Atmosphere']).toBe('Climate Change Impacts')
    expect(EXISTING_PARENTS_TO_MERGE['Mining & Energy']).toBe('Mining & Mineral Resources')
  })
})

describe('RMBL Institutional patterns stay narrow', () => {
  const INSTITUTIONAL = new Set(
    getTopicGroups().find((g) => g.group === 'RMBL Institutional')!.topics,
  )
  const institutionalMatches = (text: string) =>
    matchTopicCategories(text).filter((t) => INSTITUTIONAL.has(t))

  it('does not tag typical RMBL science titles', () => {
    for (const title of [
      'Early snowmelt and the phenology of subalpine wildflowers at RMBL',
      'Marmot alarm calls and predation risk in Gothic, Colorado',
      'Data from: soil respiration across an elevation gradient',
      'Housing density and land-use change in the Gunnison Basin',
      'Metadata for stream chemistry samples, East River',
    ]) {
      expect(institutionalMatches(title)).toEqual([])
    }
  })

  it('matches institutional phrasing', () => {
    expect(institutionalMatches('An annotated checklist of the birds of Gothic')).toContain(
      'Species Checklists & Identification Keys',
    )
    expect(institutionalMatches('A history of the Rocky Mountain Biological Laboratory')).toContain(
      'RMBL Institutional History',
    )
    expect(institutionalMatches('Field course syllabus: alpine botany')).toContain(
      'Field Courses & Syllabi',
    )
  })
})
