/**
 * Topic categorization rules.
 *
 * 40 thematic categories organized into 7 groups, reflecting the actual
 * research themes in the Gunnison Basin knowledge base. Shared by
 * organize-topics.ts (assigns freeform topics to parents) and
 * manage-topics.ts (assigns publications to topics).
 */

// ---------------------------------------------------------------------------
// Category definitions — 40 thematic parent categories
// ---------------------------------------------------------------------------

export interface CategoryDef {
  name: string
  group: string
  patterns: RegExp
}

export const TOPIC_CATEGORIES: CategoryDef[] = [
  // ---- LIFE SCIENCES (12) ----
  {
    name: 'Flowering & Pollination',
    group: 'Life Sciences',
    patterns: /\b(pollinat|flower|floral|nectar|pollen|hummingbird|trochilidae|apodiform|anthophil|plant.animal interaction|mutualis|ipomopsis|delphinium|castilleja|polemoniaceae|ranunculaceae)\b/i,
  },
  {
    name: 'Wildlife Behavior',
    group: 'Life Sciences',
    patterns: /\b(animal behav|behavior|marmot|marmota|foraging|predation|predator.prey|alarm call|sociality|courtship|mating|territoria|aggression|hibernat|vigilance|antipredator|dietary)\b/i,
  },
  {
    name: 'Alpine & Subalpine Ecology',
    group: 'Life Sciences',
    patterns: /\b(alpine|subalpine|tundra|treeline|tree.?line|elevat.*gradient|montane|meadow|high.?altitude|altitud)\b/i,
  },
  {
    name: 'Forest Ecology',
    group: 'Life Sciences',
    patterns: /\b(forest|aspen|populus tremuloides|conifer|spruce|picea|abies|pine\b|pinus|timber|canopy|woodland|dendro|tree ring|tree.ring|bark beetle|lodgepole)\b/i,
  },
  {
    name: 'Freshwater Ecology',
    group: 'Life Sciences',
    patterns: /\b(stream ecol|aquatic|limnol|macroinvertebrate|stonefl|mayfl|caddisfl|zooplankton|daphnia|benthic|trout|salvelinus|salmonid|fish\b|fisheri|amphibian|ambystoma|plecoptera|ephemeroptera|trichoptera)/i,
  },
  {
    name: 'Plant Biology',
    group: 'Life Sciences',
    patterns: /\b(botan|plant reproduct|seed\b|seedling|germinat|phenolog|plant trait|plant communit|vegetation|herbivor|salicaceae|plant growth|photosynthes|stomat|plant physiol|plant popul)\b/i,
  },
  {
    name: 'Insect Ecology',
    group: 'Life Sciences',
    patterns: /\b(entomol|insect|lepidoptera|butterfly|butterflies|pieridae|colias|bombus|bumble.?bee|bee\b|bees\b|beetle|hymenoptera|diptera|arthropod|parasitoid)\b/i,
  },
  {
    name: 'Vertebrate Biology',
    group: 'Life Sciences',
    patterns: /\b(mammal|ornithol|bird\b|birds\b|avian|herpetol|salamander|reptil|rodent|shrew|vole|bat\b|bats\b|deer\b|elk\b|ungulate|raptor|passerine|nest\b|nesting|migrat.*bird)\b/i,
  },
  {
    name: 'Microbial Ecology',
    group: 'Life Sciences',
    patterns: /\b(microb|fung|mycorrhiz|symbion|pathogen|parasit|bacteria|lichen|endophyt|decompos|microorganism|microbial communit)\b/i,
  },
  {
    name: 'Genetics & Evolution',
    group: 'Life Sciences',
    patterns: /\b(genetic|evolution|adaptation|natural selection|fitness|phenotype|genotype|morpholog|phylogenet|speciation|hybrid|genome|allele|heritab|selection pressur|gene flow)\b/i,
  },
  {
    name: 'Biodiversity & Conservation',
    group: 'Life Sciences',
    patterns: /\b(biodivers|species divers|species richness|species composition|community ecol|conserv.*biol|endangered|threatened|habitat loss|wildlife manage|sage.?grouse|rare species|protected area)\b/i,
  },
  {
    name: 'Invasive Species & Disturbance',
    group: 'Life Sciences',
    patterns: /\b(invas|exotic species|weed\b|bromus tectorum|cheatgrass|disturbance|bark beetle|fire.*ecol|wildfire|prescribed fire|land.?slide|avalanche.*ecol|successional|restor.*ecol)\b/i,
  },

  // ---- EARTH & WATER SCIENCES (8) ----
  {
    name: 'Hydrology & Watersheds',
    group: 'Earth & Water Sciences',
    patterns: /\b(hydrol|watershed|streamflow|runoff|water budget|discharge|baseflow|river\b|catchment|fluvial|hydrograph|water resource|flow regime|flood\b|flooding)\b/i,
  },
  {
    name: 'Snow & Ice',
    group: 'Earth & Water Sciences',
    patterns: /\b(snow\b|snowpack|snowmelt|snow water|snow depth|snow cover|glacier|ice\b|frost\b|freeze|avalanche|blizzard|SWE\b|cryosphere|permafrost)\b/i,
  },
  {
    name: 'Groundwater',
    group: 'Earth & Water Sciences',
    patterns: /\b(groundwater|aquifer|subsurface flow|spring\b|springs\b|recharge|water table|well\b.*water|porewater|hyporheic|vadose|saturated zone)\b/i,
  },
  {
    name: 'Water Quality',
    group: 'Earth & Water Sciences',
    patterns: /\b(water quality|dissolved solid|acid mine drainage|acid rock drainage|AMD\b|ARD\b|contaminat.*water|turbidity|water chemistry|water treatment|drinking water|effluent)\b/i,
  },
  {
    name: 'Geology & Tectonics',
    group: 'Earth & Water Sciences',
    patterns: /\b(geolog|stratigraphy|volcanic|volcanism|tectonic|uplift|rock formation|litholog|sandstone|limestone|shale|mancos|cretaceous|tertiary|cenozoic|mesozoic|paleozoic|fault\b|folding|intrusi|igneous|metamorph|mineral.*deposit)\b/i,
  },
  {
    name: 'Soil Science',
    group: 'Earth & Water Sciences',
    patterns: /\b(soil\b|soil carbon|soil moisture|soil respir|soil temp|bulk density|weathering|clay\b|pedolog|edaphic|rhizosphere|soil organic|soil microclimate)\b/i,
  },
  {
    name: 'Geochemistry & Isotopes',
    group: 'Earth & Water Sciences',
    patterns: /\b(geochemi|isotop|trace element|anion|cation|speciation|redox|DOC\b|NPOC|mass spec|chromatog|spectroscop|stoichiometr|fission.track|cosmogenic|radiometric|U.Pb|Ar.*Ar)\b/i,
  },
  {
    name: 'Paleontology & Paleoecology',
    group: 'Earth & Water Sciences',
    patterns: /\b(paleontol|paleoecol|paleoclimate|fossil\b|pollen.*record|quaternary|pleistocene|holocene|palynolog|tree.ring.*reconstruct|dendrochronol|paleo.*vegetation|megafauna|late glacial)\b/i,
  },

  // ---- CLIMATE & ENVIRONMENT (4) ----
  {
    name: 'Climate Change Impacts',
    group: 'Climate & Environment',
    patterns: /\b(climate change|global warming|warming experiment|phenolog.*shift|range shift|climate.*adapt|climate.*response|climate.*impact|climate.*driv|shrub encroach|earlier.*spring|snow.*declin)\b/i,
  },
  {
    name: 'Weather & Atmospheric Science',
    group: 'Climate & Environment',
    patterns: /\b(weather|meteorol|temperature|precipitation|radiation|solar\b|cloud\b|humidity|barometric|wind\b|atmospher.*science|atmospheric.*measur|micrometeorol|eddy.*covari)\b/i,
  },
  {
    name: 'Biogeochemical Cycling',
    group: 'Climate & Environment',
    patterns: /\b(carbon flux|carbon cycle|nitrogen cycle|nutrient cycl|decomposition rate|soil respiration|CO2\b|methane|greenhouse|net ecosystem|GPP\b|NEE\b|biogeochem)\b/i,
  },
  {
    name: 'Environmental Contamination',
    group: 'Climate & Environment',
    patterns: /\b(selenium|uranium|heavy metal|contamina|pollut|toxic|remediat|phytoremediat|mine.*tailings|mine.*waste|radionuclide|radon|lead\b.*contam|arsenic|mercury)\b/i,
  },

  // ---- HUMAN DIMENSIONS (6) ----
  {
    name: 'Mining & Mineral Resources',
    group: 'Human Dimensions',
    patterns: /\b(mining|mine\b|mineral extract|molybdenum|uranium.*mine|coal\b|ore\b|ore deposit|smelter|mill\b.*site|quarry|mt\.?\s*emmons|climax.*mine|prospect)\b/i,
  },
  {
    name: 'Land & Water Management',
    group: 'Human Dimensions',
    patterns: /\b(land.?manage|water.?right|grazing.*manage|forest.*manage|rangeland|BLM\b|bureau of land|forest service|national forest|conservancy|water district|irrigation|diversion)\b/i,
  },
  {
    name: 'Archaeology & Cultural History',
    group: 'Human Dimensions',
    patterns: /\b(archaeol|folsom|paleo.?indian|ancestral pueblo|anasazi|ute\b|fremont|lithic|projectile point|artifact|petroglyph|historic.*mining|heritage|cultural resource|antiquit)\b/i,
  },
  {
    name: 'Community Planning',
    group: 'Human Dimensions',
    patterns: /\b(community plan|housing|zoning|transport|economic develop|municipal|county.*plan|comprehensive plan|growth manage|affordable hous|subdivision|annexation|infrastructure)\b/i,
  },
  {
    name: 'Energy Development',
    group: 'Human Dimensions',
    patterns: /\b(oil shale|geothermal|solar.*energy|wind.*energy|coal.*bed.*methane|natural gas|energy develop|power plant|electric.*generat|renewable.*energy|hydroelectric|energy policy)\b/i,
  },
  {
    name: 'Recreation & Tourism',
    group: 'Human Dimensions',
    patterns: /\b(recreation|tourism|backcountry|wilderness.*area|ski\b|skiing|whitewater|rafting|hiking|camping|trail\b|outdoor|visitor|scenic|national park)\b/i,
  },

  // ---- TECHNOLOGY & DATA (4) ----
  {
    name: 'Remote Sensing & Imagery',
    group: 'Technology & Data',
    patterns: /\b(remote sens|satellite.*imag|landsat|modis|NDVI|spectral|aerial.*photo|uav\b|drone|hyperspectral|multispectral|thermal.*infrared|radar\b|SAR\b)\b/i,
  },
  {
    name: 'Geospatial Analysis',
    group: 'Technology & Data',
    patterns: /\b(GIS\b|geospatial|spatial.*analy|spatial.*model|terrain.*analy|raster|vector.*data|basemap|orthophoto|DEM\b|digital elevation|point cloud|photogramm|mapping)\b/i,
  },
  {
    name: 'Field Methods & Monitoring',
    group: 'Technology & Data',
    patterns: /\b(field method|monitor.*station|sensor\b|instrument|calibrat|sampling.*design|transect|plot\b.*design|long.term.*record|automated.*station|data.*logger|flux.*tower)\b/i,
  },
  {
    name: 'Data Science & Modeling',
    group: 'Technology & Data',
    patterns: /\b(statistic.*method|statistic.*model|bayesian|regression|machine learn|simulation|numerical.*model|time.series|interpolat|kriging|random forest|neural network|algorithm)\b/i,
  },

  // ---- PLACES & PROGRAMS (4) ----
  {
    name: 'RMBL & Gothic',
    group: 'Places & Programs',
    patterns: /\b(rmbl|rocky mountain biological laboratory|gothic.*colorado|gothic.*field|biological.*station)\b/i,
  },
  {
    name: 'Gunnison Basin',
    group: 'Places & Programs',
    patterns: /\b(gunnison|east river.*colorado|crested butte|upper gunnison|gunnison county|taylor river|ohio creek|cement creek|kebler|sapinero|curecanti|cochetopa|saguache)\b/i,
  },
  {
    name: 'Western Colorado Landscapes',
    group: 'Places & Programs',
    patterns: /\b(grand mesa|uncompahgre|roaring fork|black canyon|san juan|elk mountain|west elk|independence pass|cottonwood pass|powderhorn|lake fork|paonia|hotchkiss|pitkin county|arkansas valley|south park.*colorado)\b/i,
  },
  {
    name: 'Research Programs',
    group: 'Places & Programs',
    patterns: /\b(NEON\b|LTER\b|SAIL\b|SFA\b|SnowEx|DOE.*campaign|AmeriFlux|watershed function|ESS.DIVE|DataONE|EDI\b|earth observ|field campaign|observatory)\b/i,
  },

  // ---- EDUCATION & TRAINING (2) ----
  {
    name: 'Science Education & Pedagogy',
    group: 'Education & Training',
    patterns: /\b(science education|pedagog|teaching.*science|curriculum|science literacy|K.12|outreach|informal.*education|citizen.*science|public.*understanding|science.*communicat|STEM.*education|classroom)\b/i,
  },
  {
    name: 'Mentoring & Research Training',
    group: 'Education & Training',
    patterns: /\b(REU\b|research experience.*undergraduate|mentor|student.*research|undergraduate.*research|research.*training|internship|fellowship|graduate.*student|early.career|professional.*develop|capacity.*build)\b/i,
  },
]

// ---------------------------------------------------------------------------
// Journal-based fallback rules
// ---------------------------------------------------------------------------

export const JOURNAL_RULES: { parent: string; patterns: RegExp }[] = [
  { parent: 'Flowering & Pollination', patterns: /pollination|plant.animal/i },
  { parent: 'Wildlife Behavior', patterns: /animal behav|etholog/i },
  { parent: 'Plant Biology', patterns: /botanical|phytolog|plant science/i },
  { parent: 'Freshwater Ecology', patterns: /freshwater|limnol|fisheries|aquatic/i },
  { parent: 'Insect Ecology', patterns: /entomol|insect/i },
  { parent: 'Vertebrate Biology', patterns: /mammal|ornithol|herpetol|wildlife/i },
  { parent: 'Genetics & Evolution', patterns: /evolution|heredity|genetics|molecular ecol/i },
  { parent: 'Alpine & Subalpine Ecology', patterns: /arctic.*alpine|mountain.*research|oecologia|oikos|ecology/i },
  { parent: 'Forest Ecology', patterns: /forest.*ecol|forest.*manage|canadian.*forest/i },
  { parent: 'Biodiversity & Conservation', patterns: /conservation|biodiversity/i },
  { parent: 'Hydrology & Watersheds', patterns: /hydrol|water resources/i },
  { parent: 'Snow & Ice', patterns: /cryosphere|glaciol|cold region/i },
  { parent: 'Climate Change Impacts', patterns: /climate|global change/i },
  { parent: 'Weather & Atmospheric Science', patterns: /atmospher|meteorol|geophysical/i },
  { parent: 'Geology & Tectonics', patterns: /geolog|geomorphol|tectonophys|sediment/i },
  { parent: 'Soil Science', patterns: /soil/i },
  { parent: 'Geochemistry & Isotopes', patterns: /geochemi|biogeochem/i },
  { parent: 'Mining & Mineral Resources', patterns: /economic geology|mining/i },
  { parent: 'Land & Water Management', patterns: /land.*manage|rangeland/i },
  { parent: 'Archaeology & Cultural History', patterns: /antiquity|archaeol|american antiquity/i },
  { parent: 'Remote Sensing & Imagery', patterns: /remote sens/i },
  { parent: 'Data Science & Modeling', patterns: /statistic|model|computational/i },
  { parent: 'Science Education & Pedagogy', patterns: /science education|journal of college science/i },
]

// ---------------------------------------------------------------------------
// Old parent -> new parent mapping (for reorganizing existing assignments)
// ---------------------------------------------------------------------------

export const EXISTING_PARENTS_TO_MERGE: Record<string, string> = {
  'Water': 'Hydrology & Watersheds',
  'Water & Hydrology': 'Hydrology & Watersheds',
  'Climate': 'Climate Change Impacts',
  'Climate & Atmosphere': 'Climate Change Impacts',
  'Ecology': 'Alpine & Subalpine Ecology',
  'Ecology & Biology': 'Alpine & Subalpine Ecology',
  'Geology': 'Geology & Tectonics',
  'Soil & Geology': 'Soil Science',
  'Mining': 'Mining & Mineral Resources',
  'Mining & Energy': 'Mining & Mineral Resources',
  'Energy': 'Energy Development',
  'Land Use': 'Land & Water Management',
  'Land Use & Community': 'Land & Water Management',
  'Community': 'Community Planning',
  'Remote Sensing & GIS': 'Remote Sensing & Imagery',
  'Methods & Data Management': 'Field Methods & Monitoring',
  'Chemistry & Biogeochemistry': 'Geochemistry & Isotopes',
  'Places & Projects': 'Gunnison Basin',
  'Other': 'Other',
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/**
 * Match text against all categories, returning parent topic names.
 */
export function matchTopicCategories(text: string): string[] {
  const matches: string[] = []
  for (const cat of TOPIC_CATEGORIES) {
    if (cat.patterns.test(text)) {
      matches.push(cat.name)
    }
  }
  return matches
}

/**
 * Assign topic categories for a publication based on keywords, title, and journal.
 */
export function assignPublicationTopics(
  keywords: string[],
  title: string,
  journal: string | null,
): Set<string> {
  const assigned = new Set<string>()

  // Match keywords
  const allKeywords = keywords.join(' ')
  for (const cat of TOPIC_CATEGORIES) {
    if (cat.patterns.test(allKeywords)) {
      assigned.add(cat.name)
    }
  }

  // Also check title
  for (const cat of TOPIC_CATEGORIES) {
    if (cat.patterns.test(title)) {
      assigned.add(cat.name)
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

  return assigned
}

/**
 * Get all parent topic names (for use in homepage and search sidebar).
 */
export const PARENT_TOPIC_NAMES = TOPIC_CATEGORIES.map((c) => c.name)

/**
 * Get topic groups for organized display.
 */
export function getTopicGroups(): { group: string; topics: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const cat of TOPIC_CATEGORIES) {
    if (!groups.has(cat.group)) groups.set(cat.group, [])
    groups.get(cat.group)!.push(cat.name)
  }
  return [...groups.entries()].map(([group, topics]) => ({ group, topics }))
}
