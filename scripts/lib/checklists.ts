/**
 * Species checklists rescued from the legacy rmbl.org website — list metadata,
 * edition rules and name helpers for load-checklists.ts. Parsing happened in
 * ~/code/RMBL_metadata_rescue (rmbl_rescue.parse.species / .floristic); its
 * output is scripts/data/rescue/rmbl-legacy-checklists.json.
 */

export interface RescueRow {
  list_id: string
  list_key: string
  urlkey: string
  capture_ts: string
  edition: string | null
  line_no: number
  higher_group?: string | null
  listed_family?: string | null
  family?: string | null
  group_heading?: string | null
  scientific_name: string | null
  authority: string | null
  common_name?: string | null
  status_codes?: string | null
  remarks?: string | null
  raw_line?: string | null
  // Taylor's floristic records
  flags?: string
  species_authority?: string | null
  synonymy?: string[]
  regions?: string[]
  vegetation?: string[]
  counties?: string[]
  elev_min_ft?: number | null
  elev_max_ft?: number | null
  n_collections?: number | null
  sensitive?: boolean
  introduced?: boolean
  noxious?: boolean
  endemic?: boolean
}

export interface EditionSpec {
  label: string
  year: number | null
  taxonomy?: string
  /** Which parsed copies belong to this edition. */
  match: (r: RescueRow) => boolean
}

export interface ListSpec {
  slug: string
  title: string
  taxonGroup: string
  /** GBIF kingdom used to disambiguate names (homonyms across kingdoms). */
  kingdom: 'Plantae' | 'Animalia' | 'Fungi'
  compiler: string | null
  area: string
  description: string
  /** Status / flag codes as the list defines them. */
  legend: Record<string, string>
  editions: EditionSpec[]
  sortOrder: number
  /** Entries are common names only (the bird lists). */
  commonNamesOnly?: boolean
  /**
   * Other rescued pages holding this list (urlkeys) that the handoff file does
   * not carry rows for, recorded as copies of the (single) edition.
   */
  extraCopies?: string[]
}

const any = () => true

export const LISTS: Record<string, ListSpec> = {
  'birds-lohr': {
    slug: 'birds-gothic',
    title: 'Checklist of Birds at the RMBL and Vicinity',
    taxonGroup: 'birds',
    kingdom: 'Animalia',
    compiler: 'Susan Lohr',
    area: 'Gothic, Colorado',
    description: 'Bird checklist for Gothic and the Rocky Mountain Biological Laboratory, with abundance, residency and breeding status for each species.',
    legend: {
      R: 'rare (recorded less than once a year)',
      U: 'uncommon (fewer than 10 a day in the right habitat)',
      C: 'common (more than 10 a day in the right habitat)',
      W: 'winter resident',
      M: 'regular migrant',
      V: 'vagrant',
      B: 'summer breeding resident',
      '*': 'breeding confirmed (nest, young, territorial defense, …)',
      '?': 'breeding suspected',
    },
    editions: [
      { label: 'June 1996', year: 1996, match: (r) => r.edition === 'June 1996' },
      { label: 'March 2006', year: 2006, match: (r) => r.edition === 'March 2006' },
    ],
    sortOrder: 10,
    commonNamesOnly: true,
  },
  'plants-buck-frase': {
    slug: 'plants-gothic',
    title: 'Vascular Plants of the Gothic Area',
    taxonGroup: 'vascular plants',
    kingdom: 'Plantae',
    compiler: 'Paul Buck and Barbara A. Frase',
    area: 'Gothic area (East River headwaters, Gunnison County)',
    description: 'The RMBL Herbarium\'s checklist of the vascular plants of the Gothic area, from specimens, literature and the authors\' field collecting.',
    legend: { '+': 'added since the 1993 edition', '*': 'non-native taxon from outside North America' },
    editions: [
      { label: '1st edition (1993)', year: 1993, taxonomy: 'Harrington, Manual of the Plants of Colorado', match: (r) => r.edition == null },
      { label: '3rd edition (June 2007)', year: 2007, taxonomy: 'Hartman & Nelson (2001), with Weber & Wittmann synonyms', match: (r) => r.edition === 'June 2007' },
    ],
    sortOrder: 20,
  },
  'plants-taylor-ngb': {
    slug: 'plants-northern-gunnison-basin',
    title: 'Floristic Inventory of the Northern Gunnison Basin',
    taxonGroup: 'vascular plants',
    kingdom: 'Plantae',
    compiler: 'Kevin J. Taylor',
    area: 'Northern Gunnison Basin (ca. 2,700 sq mi)',
    description: 'Annotated species list from an MS thesis floristic survey of the northern Gunnison Basin: regions, vegetation types, counties, elevation range and number of collections for each taxon.',
    legend: { '*': 'sensitive', '!': 'introduced', '+': 'noxious', '#': 'endemic' },
    editions: [{ label: '1999 (MS thesis)', year: 1999, match: any }],
    sortOrder: 30,
    // The handoff carries only the canonical copy (pid=111) of Taylor's records;
    // these are the 2001 and 2004 copies plus the two metadata pages describing the inventory.
    extraCopies: [
      'org,rmbl)/data/ktaylor/annotatedlist.html',
      'org,rmbl)/index.php?ceid=230&func=display&meid=&module=contentexpress',
      'org,rmbl)/index.php?ceid=229&func=display&meid=&module=contentexpress',
      'org,rmbl)/home/index.php?func=display&module=htmlpages&pid=110',
    ],
  },
  'mammals-armstrong': {
    slug: 'mammals-gothic',
    title: 'Mammal Checklist for the Gothic Area',
    taxonGroup: 'mammals',
    kingdom: 'Animalia',
    compiler: 'RMBL mammal researchers, after Armstrong (1972)',
    area: 'Gothic, Colorado',
    description: 'Compiled from comments by mammal researchers at the lab, an old typewritten list, and Armstrong\'s Distribution of Mammals in Colorado (1972).',
    legend: {},
    editions: [{ label: 'as posted 2001–2010', year: null, match: any }],
    sortOrder: 40,
  },
  'butterflies-soule-inouye': {
    slug: 'butterflies-gothic',
    title: 'RMBL Butterfly List',
    taxonGroup: 'butterflies',
    kingdom: 'Animalia',
    compiler: 'Michael Soulé (1989); transcribed by David Inouye (2004)',
    area: 'Gothic townsite and lower Copper Creek',
    description: 'Michael Soulé\'s 1989 list, transcribed by David Inouye in November 2004 with corrections and additions by Ward Watt and David Inouye. Not comprehensive.',
    legend: {},
    editions: [{ label: '1989 list (transcribed 2004–2007)', year: 1989, match: any }],
    sortOrder: 50,
  },
  'fungi-barrell': {
    slug: 'mushrooms-gothic',
    title: 'Mushroom List',
    taxonGroup: 'fungi',
    kingdom: 'Fungi',
    compiler: 'Beth Barrell',
    area: 'Gothic Valley, Crystal, Washington Gulch, Ohio Peak (West Elks), Saguache Park, Cochetopa Pass',
    description: 'Mushrooms of the RMBL area with spore colour, habitat and abundance notes; later copies add a section of edible mushrooms.',
    legend: {},
    editions: [{ label: 'as posted 2003–2010', year: null, match: any }],
    sortOrder: 60,
  },
  herps: {
    slug: 'amphibians-reptiles-gothic',
    title: 'Amphibian and Reptile Checklist for Gothic',
    taxonGroup: 'amphibians and reptiles',
    kingdom: 'Animalia',
    compiler: null,
    area: 'Gothic, Colorado',
    description: 'The amphibians and reptiles of the Gothic area, with notes on the boreal toad (very rare) and leopard frog (locally extinct).',
    legend: {},
    editions: [{ label: 'as posted 2001–2010', year: null, match: any }],
    sortOrder: 70,
  },
}

/**
 * Buck & Frase's authorities page lists the 1993 edition's taxa with
 * authorities; it fills the 1993 entries' authority and is recorded as a
 * companion copy of that edition rather than a list of its own.
 */
export const AUTHORITIES_LIST = 'plants-buck-frase-authorities'
export const AUTHORITIES_FOR = { list: 'plants-buck-frase', edition: '1st edition (1993)' }

/**
 * Reviewed corrections for names GBIF can't settle on its own (2026-11-18):
 * misspellings in the lists, common names shared with a fossil or foreign
 * species, and splits where the Colorado population is unambiguous. Each value
 * is a scientific name, then resolved like any other. Deliberately absent:
 * Barn Owl and Yellow Warbler (splits that depend on the taxonomy followed),
 * Cordilleran Flycatcher (lumped 2023), "Red-backed Hawk" (unclear), hybrids.
 */
export const MANUAL_NAMES: Record<string, string> = {
  // birds — misspellings
  'Ferruginus Hawk': 'Buteo regalis',
  'Loggernead Shrike': 'Lanius ludovicianus',
  "Townsand's Warbler": 'Setophaga townsendi',
  // birds — namesakes elsewhere (fossil, Old World, New Zealand)
  'Golden Eagle': 'Aquila chrysaetos',
  Osprey: 'Pandion haliaetus',
  'Common Nighthawk': 'Chordeiles minor',
  'Dusky Flycatcher': 'Empidonax oberholseri',
  'Tree Swallow': 'Tachycineta bicolor',
  'Rock Wren': 'Salpinctes obsoletus',
  'Brown Creeper': 'Certhia americana',
  Veery: 'Catharus fuscescens',
  // birds — splits; the Colorado population is the North American / interior form
  'Green-winged Teal': 'Anas carolinensis',
  'Common Snipe': 'Gallinago delicata',
  'Northern Pygmy-Owl': 'Glaucidium gnoma',
  'Black-billed Magpie': 'Pica hudsonia',
  'Northern Shrike': 'Lanius borealis',
  'Scrub Jay': 'Aphelocoma woodhouseii',
  'Sage Sparrow': 'Artemisiospiza nevadensis',
  // mammals, butterflies, fungi — misspellings and old combinations
  'Erithizon dorsatum': 'Erethizon dorsatus',
  'Plebeius icarioides': 'Plebejus icarioides',
  'Lycaena dorsas': 'Lycaena dorcas',
  'Microtia palla': 'Chlosyne palla',
  'Mycena campanella': 'Xeromphalina campanella',
  'Collybia butyraceae': 'Rhodocollybia butyracea',
  'Collybia velutipes': 'Flammulina velutipes',
  'Clavariadelphus trucatus': 'Clavariadelphus truncatus',
  'Leccinum fibrilolosum': 'Leccinum fibrillosum',
}

export const sourceIdOf = (urlkey: string) => `rmbl-wayback:${urlkey}`

/**
 * Group parsed rows into editions; each edition's entries come from its
 * latest-captured copy (re-hosts were corrected copies: the CMS plant list
 * fixes the 2001 page's OCR errors).
 */
export function groupEditions(listId: string, rows: RescueRow[]): {
  spec: EditionSpec
  sourceIds: string[]
  entriesSourceId: string
  rows: RescueRow[]
}[] {
  const list = LISTS[listId]
  if (!list) throw new Error(`No list config for ${listId}`)
  const out = []
  for (const spec of list.editions) {
    const mine = rows.filter((r) => r.list_id === listId && spec.match(r))
    if (mine.length === 0) continue
    const copies = new Map<string, string>() // urlkey -> latest capture
    for (const r of mine) if (!copies.has(r.urlkey) || copies.get(r.urlkey)! < r.capture_ts) copies.set(r.urlkey, r.capture_ts)
    const [bestKey] = [...copies].sort((a, b) => b[1].localeCompare(a[1]))[0]
    const bestTs = copies.get(bestKey)!
    out.push({
      spec,
      sourceIds: [...copies.keys()].sort().map(sourceIdOf),
      entriesSourceId: sourceIdOf(bestKey),
      rows: mine.filter((r) => r.urlkey === bestKey && r.capture_ts === bestTs).sort((a, b) => a.line_no - b.line_no),
    })
  }
  return out
}

/**
 * The binomial used for matching: genus + epithet, without subgenus, hybrid
 * marker, authority or infraspecific rank. "Equisetum hyemale var. affine" →
 * "Equisetum hyemale"; "Bombus (Pyrobombus) bifarius" → "Bombus bifarius".
 */
export function binomialOf(name: string | null | undefined): string | null {
  if (!name) return null
  const m = /^\s*([A-Z][a-z-]+)\s+(?:[([][A-Z][a-z]+[)\]]\s+)?(?:[x×]\s+)?([a-z][a-z-]+)/.exec(name.replace(/[‘’"]/g, ''))
  if (!m) return null
  if (['sp', 'spp', 'species', 'var', 'ssp', 'subsp'].includes(m[2])) return null
  return `${m[1]} ${m[2]}`
}

/**
 * Spellings to retry when a strict match fails: the 2001 plant page was OCR'd
 * with "q" for "g" ("Pseudotsuqa", "laeviqatum"), and older lists use the
 * single-i genitive ("engelmanni" for "engelmannii", an orthographic variant).
 */
export function spellingVariants(binomial: string): string[] {
  const out = new Set<string>()
  const ocr = binomial.replace(/q(?!u)/g, 'g')
  for (const b of [binomial, ocr]) {
    out.add(b)
    const [g, ep] = b.split(' ')
    if (/[^aeiou]i$/.test(ep)) out.add(`${g} ${ep}i`)
  }
  out.delete(binomial)
  return [...out]
}

/** Status codes spelled out with the list's legend: "U,M,B*" → ["uncommon …", "regular migrant", …]. */
export function decodeStatus(listId: string, codes: string | null | undefined): string[] {
  if (!codes) return []
  const legend = LISTS[listId]?.legend ?? {}
  const out: string[] = []
  for (const part of codes.split(/[,\s]+/).filter(Boolean)) {
    // "B*" / "B?" = breeding resident + confirmed/suspected; Taylor's "+!" = two flags.
    for (const ch of part.match(/[A-Z]|[*?+!#]/g) ?? []) if (legend[ch] && !out.includes(legend[ch])) out.push(legend[ch])
  }
  return out
}
