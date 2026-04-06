/**
 * Seed Projects Collection
 *
 * Populates the Projects collection from two hardcoded sources:
 *   1. ~108 research plans from the 2024 RMBL Research Plan List
 *   2. ~10 larger programmatic projects / campaigns
 *
 * Requires the dev server running (uses Payload REST API).
 *
 * Usage:
 *   npx tsx scripts/seed-projects.ts
 *   npx tsx scripts/seed-projects.ts --dry-run
 */

import {
  ensureAuth,
  createRecord,
  checkServer,
  getAllPaginated,
  findByField,
} from './lib/payload-client.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResearchPlan {
  owner: string
  name: string
  field: string
  researchAreas: string[]
}

interface ProgrammaticProject {
  name: string
  pis: string[]
  projectType: 'program' | 'campaign'
  description: string
}

// ---------------------------------------------------------------------------
// Data: Research Plans from 2024 RMBL Research Plan List
// ---------------------------------------------------------------------------

const RESEARCH_PLANS: ResearchPlan[] = [
  { owner: 'Clifford Adamchak', name: 'Beaver Ponds: Methylmercury Production and Export in the Western U.S', field: 'Other', researchAreas: ['Biogeochemistry', 'Hydrology'] },
  { owner: 'Katie Adler', name: 'Evaluating mechanisms underlying disturbance-related demographic change', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Long-term research'] },
  { owner: 'Ruben Alarcon', name: 'Impacts of dandelions (Taraxacum officinale) on plant-pollinator networks', field: 'Ecology and Evolutionary biology', researchAreas: ['Community ecology', 'Food web biology', 'Insect biology', 'Pollination'] },
  { owner: 'Fatima Alcantara', name: 'Pollen limitation in an insect-pollinated, masting perennial', field: 'Ecology and Evolutionary biology', researchAreas: ['Phenology', 'Plant biology', 'Pollination'] },
  { owner: 'Jill Anderson', name: 'Interactive effects of biotic and abiotic conditions on local adaptation', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Genetics', 'Phenology', 'Plant biology', 'Species Interactions'] },
  { owner: 'Jordan Argrett', name: 'Are hemiparasitic plants the "Robinhood" of sub-alpine communities?', field: 'Ecology and Evolutionary biology', researchAreas: ['Community ecology', 'Plant biology', 'Soil/microbial ecology'] },
  { owner: 'Kaysee Arrowsmith', name: 'Drivers of pollinator niche variation', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Pollination', 'Species Interactions'] },
  { owner: 'Holly Barnard', name: 'Quantifying controls of dynamic storage on critical zone processes', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Climate change', 'Geology', 'Hydrology', 'Modeling'] },
  { owner: 'Thibaut Barra', name: 'Individual variation in predictability, its evolutionary consequences', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Long-term research'] },
  { owner: 'Taylor Bastian', name: 'Socially-driven fitness consequences of environmental variation', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Long-term research', 'Modeling'] },
  { owner: 'Parker Bausman', name: 'N. hostilis effects on timing, amount and distance of subsidy exports', field: 'Ecology and Evolutionary biology', researchAreas: ['Aquatic Biology', 'Climate change', 'Community ecology', 'Food web biology', 'Insect biology', 'Landscape biology', 'Species Interactions'] },
  { owner: 'Max Berkelhammer', name: 'Topographic controls on transpiration in the East River watershed', field: 'Hydrology', researchAreas: ['Atmospheric Science', 'Biogeochemistry', 'Climate change', 'Hydrology', 'Modeling'] },
  { owner: 'Amrita Bhattacharyya', name: 'Anoxic microsites control methanogenesis at terrestrial-aquatic interfaces', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Climate change', 'Geology', 'Hydrology', 'Microbiology'] },
  { owner: 'Benjamin Blonder', name: 'Plant community dynamics in a changing environment', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Genetics', 'Landscape biology', 'Long-term research', 'Modeling', 'Plant biology', 'Species Interactions'] },
  { owner: 'Dan Blumstein', name: 'Vertebrate antipredator and communication studies', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Vertebrate biology', 'Other'] },
  { owner: 'Dan Blumstein', name: 'The marmots of RMBL', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Disease ecology', 'Genetics', 'Long-term research', 'Microbiomes', 'Modeling', 'Phenology', 'Vertebrate biology'] },
  { owner: 'Carol Boggs', name: 'Drought response as escape from apparent maladaptation', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Community ecology', 'Genetics', 'Insect biology', 'Landscape biology', 'Plant biology', 'Species Interactions'] },
  { owner: 'Carol Boggs', name: 'Soulé Butterfly Re-survey', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Insect biology', 'Long-term research', 'Phenology'] },
  { owner: 'Janelle Bohey', name: 'Effect of drought on floral scent and plant-pollinator interactions', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'Ian Breckheimer', name: 'The Spatial Ecology of Environmental Change in the Upper Gunnison Watershed', field: 'Ecology and Evolutionary biology', researchAreas: ['Atmospheric Science', 'Climate change', 'Community ecology', 'Hydrology', 'Landscape biology', 'Modeling', 'Phenology', 'Plant biology', 'Pollination', 'Snow Science'] },
  { owner: 'Alison Brody', name: 'Effects of herbivory on life-history and long-term demography', field: 'Ecology and Evolutionary biology', researchAreas: ['Long-term research', 'Plant biology', 'Species Interactions'] },
  { owner: 'Berry Brosi', name: 'Pollination Network Structure, Function, and Response to Perturbation', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Community ecology', 'Genetics', 'Insect biology', 'Modeling', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions', 'Theory'] },
  { owner: 'Diane Campbell', name: 'Long-term studies of plant evolution and demography', field: 'Biology', researchAreas: ['Climate change', 'Long-term research', 'Plant biology', 'Pollination'] },
  { owner: 'Paul CaraDonna', name: 'Long-term monitoring of bee-plant interactions', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Community ecology', 'Food web biology', 'Insect biology', 'Long-term research', 'Modeling', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'Mariah Carbone', name: 'Response of plant and microbial respiration to changing cold season climate', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Climate change', 'Climate science', 'Phenology', 'Soil/microbial ecology'] },
  { owner: 'Lauren Carley', name: 'Joint fates of genetic variation and demography under changing climates', field: 'Ecology and Evolutionary biology', researchAreas: ['Genetics', 'Long-term research', 'Modeling', 'Plant biology', 'Species Interactions', 'Other'] },
  { owner: 'Aimee Classen', name: 'Warming and Species interactions', field: 'Ecology and Evolutionary biology', researchAreas: ['Biogeochemistry', 'Climate change', 'Community ecology', 'Food web biology', 'Long-term research', 'Microbiomes', 'Microbiology', 'Modeling', 'Phenology', 'Plant biology', 'Soil/microbial ecology', 'Species Interactions'] },
  { owner: 'Samantha Day', name: 'Conflicting Selection on Flower Size in Iris missouriensis', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Genetics', 'Plant biology', 'Pollination'] },
  { owner: 'Lee "Mick" Demi', name: 'Chronic Ndeposition and Didymosphenia geminata blooms', field: 'Ecology and Evolutionary biology', researchAreas: ['Aquatic Biology'] },
  { owner: 'Sabine Dritz', name: 'The functional response of Bombus sp. in multi-resource environments', field: 'Ecology and Evolutionary biology', researchAreas: ['Community ecology', 'Modeling', 'Pollination', 'Species Interactions', 'Theory'] },
  { owner: 'Laurent Duverglas', name: 'The effects of tri-trophic interactions on insect population dynamics', field: 'Ecology and Evolutionary biology', researchAreas: ['Insect biology', 'Species Interactions'] },
  { owner: 'Bret Elderd', name: 'General Observations of Plant-Lichen and Plant-Herbivore Interactions', field: 'Ecology and Evolutionary biology', researchAreas: ['Community ecology', 'Species Interactions'] },
  { owner: 'Brian Enquist', name: 'Assessing drivers of vegetation functional change', field: 'Biology', researchAreas: ['Climate change', 'Community ecology', 'Hydrology', 'Long-term research', 'Modeling', 'Plant biology', 'Soil/microbial ecology', 'Snow Science', 'Species Interactions', 'Theory'] },
  { owner: 'Jacquelyn Fitzgerald', name: 'Bumble bee thermal tolerance, climate variation, and population trends', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Insect biology', 'Pollination'] },
  { owner: 'Jessica Forrest', name: 'Population ecology and evolutionary biology of solitary bees', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Insect biology', 'Long-term research', 'Phenology', 'Pollination', 'Species Interactions'] },
  { owner: 'Elsa Godtfredsen', name: 'Impacts of Early Snowmelt on Subalpine Plant Reproduction and Survival', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'Hamish Greig', name: 'Long-term research on the ecology of ponds in a changing climate', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Aquatic Biology', 'Climate change', 'Community ecology', 'Food web biology', 'Insect biology', 'Long-term research', 'Species Interactions'] },
  { owner: 'Josh Grinath', name: 'Long-term effects of nitrogen deposition and bears in ecological networks', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Atmospheric Science', 'Community ecology', 'Food web biology', 'Insect biology', 'Long-term research', 'Plant biology', 'Soil/microbial ecology', 'Species Interactions', 'Vertebrate biology'] },
  { owner: 'Anna Grinath', name: 'Authoring disciplinary identities in a community of science practice', field: 'Other', researchAreas: ['Other'] },
  { owner: 'John Harte', name: 'Vegetation Recovery after Termination of Heating', field: 'Ecology and Evolutionary biology', researchAreas: ['Atmospheric Science', 'Climate change', 'Community ecology', 'Long-term research', 'Modeling', 'Plant biology', 'Theory'] },
  { owner: 'Jacob Heiling', name: 'Floral volitile ecology of Lupinus argenteus', field: 'Ecology and Evolutionary biology', researchAreas: ['Ecology'] },
  { owner: 'Amy Iler', name: 'Consequences of phenological shifts and pollination for plant populations', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Community ecology', 'Long-term research', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'David Inouye', name: 'Long-term study of wildflowers', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Community ecology', 'Long-term research', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions', 'Vertebrate biology'] },
  { owner: 'Brian Inouye', name: 'Underwood-Inouye long-term phenology', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Insect biology', 'Phenology', 'Plant biology', 'Species Interactions'] },
  { owner: 'David Inouye', name: 'Supplement Collection of fecal material from hummingbirds', field: 'Ecology and Evolutionary biology', researchAreas: ['Food web biology', 'Vertebrate biology'] },
  { owner: 'David Inouye', name: 'Supplement Estimate of resident deer population size in Gothic', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Vertebrate biology'] },
  { owner: 'Rebecca Irwin', name: 'Effect of climate variability on bee phenology and abundance', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Community ecology', 'Insect biology', 'Long-term research', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'Juliana Jiranek', name: 'Evolution and epidemiology in plant-pathogen systems under climate change', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Disease ecology', 'Genetics', 'Long-term research', 'Modeling', 'Phenology', 'Plant biology', 'Theory'] },
  { owner: 'Stephanie Kampf', name: 'Stream Tracker: Documenting flow duration on non-perennial streams', field: 'Hydrology', researchAreas: ['Hydrology'] },
  { owner: 'Melanie Kazenel', name: 'Effects of microclimate heterogeneity on plant-pollinator interactions', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Community ecology', 'Insect biology', 'Landscape biology', 'Phenology', 'Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'Chloe Keck', name: 'Integrating resource allocation, vision, and fitness in Speyeria mormonia', field: 'Biology', researchAreas: ['Animal Behavior', 'Community ecology', 'Insect biology'] },
  { owner: 'Gwen Kirschke', name: 'Tracking Bumble Bee Movement Patterns in Subalpine Meadows', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Community ecology', 'Insect biology', 'Landscape biology', 'Pollination'] },
  { owner: 'Stephanie Kivlin', name: 'Decoupling plant and mycorrhizal fungal phenology in the Anthropocene', field: 'Ecology and Evolutionary biology', researchAreas: ['Biogeochemistry', 'Climate change', 'Community ecology', 'Microbiomes', 'Modeling', 'Phenology', 'Soil/microbial ecology', 'Snow Science', 'Species Interactions'] },
  { owner: 'Kyla Knauf', name: 'Wildflower Reproduction Phenology and Seed Traits under Early Snowmelt', field: 'Biology', researchAreas: ['Phenology', 'Plant biology'] },
  { owner: 'Lara Kueppers', name: 'Climate effects on forest structure, dynamics and hydrologic function', field: 'Earth Systems Science', researchAreas: ['Climate change', 'Landscape biology', 'Long-term research', 'Modeling', 'Plant biology'] },
  { owner: 'Lara Kueppers', name: 'GLORIA@RMBL', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Community ecology', 'Landscape biology', 'Long-term research'] },
  { owner: 'Isaac Larsen', name: 'Abiotic and biotic controls on chemical weathering rates and solute generation', field: 'Earth Systems Science', researchAreas: ['Climate science', 'Geology', 'Hydrology'] },
  { owner: 'Corey Lawrence', name: 'Regional Assessment of Drought Impacts on Soils', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Climate change', 'Geology', 'Long-term research', 'Modeling', 'Phenology', 'Plant biology', 'Soil/microbial ecology'] },
  { owner: 'Heron Lenz', name: 'Species Traits Influence Response of Ant-Aphid Mutualism to Thermal Changes', field: 'Biology', researchAreas: ['Animal Behavior', 'Climate change', 'Community ecology', 'Insect biology', 'Modeling', 'Species Interactions'] },
  { owner: 'Li Li', name: 'Water at Coal Creek', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Climate change', 'Geology', 'Hydrology', 'Modeling', 'Snow Science', 'Theory'] },
  { owner: 'Jessica Lundquist', name: 'Seasonal Cycles Unravel Mysteries of Missing Mountain Water', field: 'Hydrology', researchAreas: ['Atmospheric Science', 'Biogeochemistry', 'Climate change', 'Climate science', 'Hydrology', 'Meteorology', 'Microbiomes', 'Modeling', 'Snow Science'] },
  { owner: 'Patrick Magee', name: 'Ecology of wintering mammals in the Rocky Mountains', field: 'Other', researchAreas: ['Vertebrate biology'] },
  { owner: 'Max Mallen-Cooper', name: 'Thresholds and tipping points in ecosystem responses to global warming', field: 'Ecology and Evolutionary biology', researchAreas: ['Biogeochemistry', 'Climate change', 'Community ecology', 'Species Interactions'] },
  { owner: 'Audrey Miller', name: 'Receiver roles in hummingbird courtship', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Other'] },
  { owner: 'Kailen Mooney', name: 'Plant-Herbivore Interactions Along Elevational Gradients', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Community ecology', 'Food web biology', 'Insect biology', 'Plant biology', 'Species Interactions', 'Theory'] },
  { owner: 'Emily Mooney', name: 'Insects on Ligusticum', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Insect biology', 'Phenology', 'Snow Science'] },
  { owner: 'Jocelyn Navarro', name: 'Using a turf transplant experiment to study plant functional traits', field: 'Atmospheric Science', researchAreas: ['Climate change', 'Community ecology', 'Hydrology', 'Plant biology'] },
  { owner: 'Nhan Nguyen', name: 'Dispersal choice of female golden-mantled ground squirrels', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Long-term research', 'Vertebrate biology'] },
  { owner: 'Bobbi Peckarsky', name: 'Integrating stream research, teaching and outreach', field: 'Biology', researchAreas: ['Aquatic Biology', 'Climate change', 'Community ecology', 'Insect biology', 'Long-term research'] },
  { owner: 'William Petry', name: 'Forecasting population dynamics in changing environments', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Long-term research', 'Modeling', 'Plant biology', 'Theory'] },
  { owner: 'Sam Pierce', name: 'Beaver dam influence on floodplain hydro-biogeochemistry', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Hydrology'] },
  { owner: 'Mark Raleigh', name: 'Snow process studies in the East River Basin', field: 'Snow Science', researchAreas: ['Snow Science'] },
  { owner: 'Evan Ramos', name: 'Clay formation and organic matter stabilization across an alpine watershed', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Climate change', 'Geology', 'Hydrology', 'Soil/microbial ecology'] },
  { owner: 'Kelsey Reider', name: 'Context-Dependent Life History Responses to Climate Change', field: 'Ecology and Evolutionary biology', researchAreas: ['Aquatic Biology', 'Climate change', 'Phenology', 'Vertebrate biology'] },
  { owner: 'Timberley Roane', name: 'Microbial Genomics Analysis of the Mt. Emmons Acidic, Metal-Impacted Fen', field: 'Biology', researchAreas: ['Microbiology'] },
  { owner: 'Robert Schaeffer', name: 'Context-dependent effects of nectar microbes on pollination mutualisms', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Community ecology', 'Insect biology', 'Microbiology', 'Plant biology', 'Pollination', 'Soil/microbial ecology', 'Species Interactions'] },
  { owner: 'Alden Sears', name: 'How interactions with mutualists & predators shape plant coexistence', field: 'Ecology and Evolutionary biology', researchAreas: ['Community ecology', 'Plant biology', 'Pollination', 'Species Interactions', 'Theory'] },
  { owner: 'Austin Simonpietri', name: 'Ecohydrologic Controls of Sub-Alpine Forest Soil Respiration', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Climate change', 'Long-term research', 'Microbiology', 'Phenology', 'Plant biology', 'Soil/microbial ecology', 'Snow Science'] },
  { owner: 'Rosemary Smith', name: 'Behavioral Ecology of Burying Beetles', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Biogeochemistry', 'Climate change', 'Community ecology', 'Food web biology', 'Insect biology', 'Long-term research', 'Phenology', 'Soil/microbial ecology', 'Species Interactions', 'Vertebrate biology'] },
  { owner: 'Lara Souza', name: 'Physiological drivers of plant community and ecosystem processes', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Community ecology'] },
  { owner: 'Matthias Sprenger', name: 'LateSt-Iso: Ecohydrology via high-frequency stable isotope measurements', field: 'Hydrology', researchAreas: ['Hydrology'] },
  { owner: 'Jeannie Stamberger', name: 'Long-term, high-resolution ground temperature study of Colias meadii habitats', field: 'Biology', researchAreas: ['Climate change', 'Insect biology', 'Long-term research', 'Modeling'] },
  { owner: 'Heidi Steltzer', name: "Vegetation's influence on mountain watershed function", field: 'Atmospheric Science', researchAreas: ['Atmospheric Science'] },
  { owner: 'Kristina Stinson', name: 'Ecology and impacts of non-native mustards in the subalpine zone', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Insect biology', 'Microbiomes', 'Phenology', 'Plant biology'] },
  { owner: 'Mary (Cassie) Stoddard', name: 'Mechanisms of color vision in hummingbirds', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate science', 'Community ecology', 'Pollination', 'Species Interactions', 'Vertebrate biology'] },
  { owner: 'Blair Stokes', name: 'Natural variation of fructose-1,6-bisphosphatase and larval development', field: 'Biology', researchAreas: ['Genetics', 'Insect biology'] },
  { owner: 'Harry Stone', name: 'Modeling Drivers of Summer Streamflow Changes at the Micro-catchment Scale', field: 'Hydrology', researchAreas: ['Climate change', 'Hydrology', 'Snow Science'] },
  { owner: 'Brad Taylor', name: 'Linking changing snowpack to stream ecosystem structure and function', field: 'Ecology and Evolutionary biology', researchAreas: ['Aquatic Biology', 'Biogeochemistry', 'Climate change', 'Community ecology', 'Disease ecology', 'Food web biology', 'Hydrology', 'Long-term research', 'Species Interactions'] },
  { owner: 'Zachary Taylor', name: 'Paleoenvironmental reconstruction in the Gunnison Basin from sediments', field: 'Geology', researchAreas: ['Biogeochemistry', 'Climate change', 'Climate science'] },
  { owner: 'Stavi Tennenbaum', name: 'Epigenetic variation & accelerated aging in the seasonal habitat of marmots', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Genetics', 'Long-term research', 'Phenology', 'Vertebrate biology'] },
  { owner: 'James Thomson', name: 'Glacier Lily Demography', field: '', researchAreas: ['Plant biology', 'Pollination'] },
  { owner: 'Olivia Vought', name: 'The Impact of Climate Change on Ecosystem Structure and Function', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Community ecology', 'Microbiology', 'Phenology', 'Plant biology', 'Soil/microbial ecology', 'Snow Science', 'Species Interactions'] },
  { owner: 'Maggie Wagner', name: 'Boechera stricta microbiome evolution II', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Genetics', 'Microbiomes', 'Plant biology', 'Soil/microbial ecology'] },
  { owner: 'Haruko Wainwright', name: 'Multiscale Heterogeneity of Soil Moisture: Differential Drying', field: 'Hydrology', researchAreas: ['Climate science', 'Hydrology'] },
  { owner: 'Susan Washko', name: 'Aquatic invertebrates and trout in beaver ponds of different ages', field: 'Ecology and Evolutionary biology', researchAreas: ['Community ecology', 'Food web biology', 'Insect biology', 'Vertebrate biology'] },
  { owner: 'Ward Watt', name: 'Molecular evolution of Colias butterflies', field: 'Ecology and Evolutionary biology', researchAreas: ['Genetics', 'Insect biology'] },
  { owner: 'Laura Watt', name: 'Continuing Archival Research of the Environmental History of RMBL', field: 'Other', researchAreas: ['Long-term research', 'Other'] },
  { owner: 'Ren Weinstock', name: 'Impacts of Climate Change on Bee Behavior across Socio-Ecological Contexts', field: 'Biology', researchAreas: ['Animal Behavior', 'Climate change', 'Genetics', 'Insect biology'] },
  { owner: 'Caitlin Wells', name: 'Reproductive phenology in golden-mantled ground squirrels', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Climate change', 'Genetics', 'Long-term research', 'Phenology', 'Vertebrate biology'] },
  { owner: 'Howard Whiteman', name: 'Evolutionary Ecology and Conservation Biology of Amphibians', field: 'Ecology and Evolutionary biology', researchAreas: ['Animal Behavior', 'Aquatic Biology', 'Climate change', 'Community ecology', 'Disease ecology', 'Food web biology', 'Long-term research', 'Modeling', 'Phenology', 'Species Interactions', 'Theory', 'Vertebrate biology'] },
  { owner: 'Kenneth Whitney', name: 'Evolutionary Ecology of Floral Color', field: 'Ecology and Evolutionary biology', researchAreas: ['Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'Kenneth Hurst Williams', name: 'Watershed Function SFA', field: 'Earth Systems Science', researchAreas: ['Biogeochemistry', 'Geology', 'Hydrology', 'Microbiomes', 'Microbiology', 'Modeling', 'Soil/microbial ecology', 'Snow Science'] },
  { owner: 'Rick Williams', name: 'Expanding Natural History and Community Science Resources at RMBL', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Community ecology', 'Genetics', 'Insect biology', 'Landscape biology', 'Long-term research', 'Phenology', 'Plant biology'] },
  { owner: 'Matthew Winnick', name: 'Stream Corridor Hydrologic Controls on Carbon Dioxide Fluxes', field: '', researchAreas: ['Biogeochemistry', 'Hydrology', 'Modeling'] },
  { owner: 'Lydia Wong', name: 'Determinants of upper-elevation range limits in cavity-nesting bees', field: 'Ecology and Evolutionary biology', researchAreas: ['Climate change', 'Climate science', 'Community ecology', 'Insect biology', 'Phenology', 'Pollination'] },
  { owner: 'Anne Worley', name: 'Geographic variation in floral shape and scent in Polemonium brandegeei', field: 'Ecology and Evolutionary biology', researchAreas: ['Plant biology', 'Pollination', 'Species Interactions'] },
  { owner: 'Marshall Worsham', name: 'Soil moisture and growth responses to climate extremes in subalpine forests', field: 'Ecology and Evolutionary biology', researchAreas: ['Biogeochemistry', 'Climate change', 'Community ecology', 'Hydrology', 'Long-term research', 'Plant biology', 'Snow Science'] },
  { owner: 'Megan Zerger', name: 'Assessing corticosterone and Bd infection in Ambystoma mavortium nebulosum', field: 'Ecology and Evolutionary biology', researchAreas: ['Aquatic Biology', 'Disease ecology'] },
]

// ---------------------------------------------------------------------------
// Data: Programmatic Projects
// ---------------------------------------------------------------------------

const PROGRAMMATIC_PROJECTS: ProgrammaticProject[] = [
  {
    name: 'RMBL Warming Meadow',
    pis: ['John Harte', 'Aimee Classen'],
    projectType: 'program',
    description: 'Experimental warming of a subalpine meadow using infrared heaters. Ongoing since 1990.',
  },
  {
    name: 'East River Watershed Function SFA',
    pis: ['Kenneth Hurst Williams'],
    projectType: 'program',
    description: 'DOE-funded watershed science. Quantifying how mountains retain and release water.',
  },
  {
    name: 'RMBL Marmot Project',
    pis: ['Dan Blumstein', 'Kenneth Armitage'],
    projectType: 'program',
    description: 'Long-term study of yellow-bellied marmots. Ongoing since 1962.',
  },
  {
    name: 'SnowEx',
    pis: ['NASA'],
    projectType: 'campaign',
    description: 'NASA snow remote sensing campaign at Grand Mesa and nearby sites.',
  },
  {
    name: 'SAIL (Surface Atmosphere Integrated Laboratory)',
    pis: ['ARM/DOE'],
    projectType: 'campaign',
    description: 'ARM mobile facility deployment in Gunnison Valley 2021-2023.',
  },
  {
    name: 'SPLASH (Sublimation of Snow, Photosynthesis, and Linked Atmospheric and Surface Hydroclimatology)',
    pis: ['DOE'],
    projectType: 'campaign',
    description: 'DOE field campaign studying snow sublimation.',
  },
  {
    name: 'Underwood-Inouye Long-term Phenology',
    pis: ['David Inouye', 'Brian Inouye'],
    projectType: 'program',
    description: 'Wildflower phenology monitoring in permanent plots. Ongoing since 1973.',
  },
  {
    name: 'RMBL Butterfly Monitoring',
    pis: ['Carol Boggs', 'Ward Watt'],
    projectType: 'program',
    description: 'Long-term butterfly population monitoring.',
  },
  {
    name: 'Stream Ecology Long-term Research',
    pis: ['Bobbi Peckarsky'],
    projectType: 'program',
    description: 'Long-term stream food web research.',
  },
  {
    name: 'WaRM (Warming and Removal in Mountains)',
    pis: ['Aimee Classen'],
    projectType: 'program',
    description: 'Warming and species removal manipulation experiment.',
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run')

/** Extract family name from a full name like "Kenneth Hurst Williams" -> "Williams" */
function extractFamilyName(fullName: string): string {
  const parts = fullName.replace(/[""()]/g, '').trim().split(/\s+/)
  return parts[parts.length - 1]
}

/** Build discovery keywords from plan name + research areas */
function buildDiscoveryKeywords(name: string, researchAreas: string[], ownerFamilyName: string): string {
  const keywords = [name, ownerFamilyName, ...researchAreas]
  return keywords.join('\n')
}

// ---------------------------------------------------------------------------
// Author Cache
// ---------------------------------------------------------------------------

const authorCache = new Map<string, string | null>()

async function loadAuthorCache(): Promise<void> {
  console.log('  Loading author records...')
  const authors = await getAllPaginated('authors')
  for (const author of authors) {
    const key = (author.familyName as string).toLowerCase()
    // Store first match per family name
    if (!authorCache.has(key)) {
      authorCache.set(key, String(author.id))
    }
  }
  console.log(`  Cached ${authorCache.size} unique author family names`)
}

function findAuthorByFamilyName(familyName: string): string | null {
  return authorCache.get(familyName.toLowerCase()) ?? null
}

// ---------------------------------------------------------------------------
// Seed Research Plans
// ---------------------------------------------------------------------------

async function seedResearchPlans(): Promise<{ created: number; skipped: number; errors: number }> {
  console.log(`\n--- Seeding ${RESEARCH_PLANS.length} Research Plans ---`)

  let created = 0
  let skipped = 0
  let errors = 0

  for (const plan of RESEARCH_PLANS) {
    const familyName = extractFamilyName(plan.owner)
    const discoveryKeywords = buildDiscoveryKeywords(plan.name, plan.researchAreas, familyName)
    const authorId = findAuthorByFamilyName(familyName)

    const record: Record<string, unknown> = {
      name: plan.name,
      projectType: 'research_plan',
      status: 'active',
      pi: plan.owner,
      fieldOfScience: plan.field || undefined,
      researchAreas: plan.researchAreas.join('; '),
      discoveryKeywords,
      autoDiscoveryEnabled: true,
    }

    // piAuthor linking deferred — requires Payload relationship table alignment
    // if (authorId) { record.piAuthor = authorId }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create: "${plan.name}" (PI: ${plan.owner}${authorId ? ', linked to author ' + authorId : ''})`)
      created++
      continue
    }

    try {
      // Check if already exists by name
      const existingId = await findByField('projects', 'name', plan.name)
      if (existingId) {
        skipped++
        continue
      }

      const result = await createRecord('projects', record)
      if (result) {
        created++
        if (created % 20 === 0) {
          console.log(`  Created ${created} research plans...`)
        }
      } else {
        // null means duplicate (unique constraint)
        skipped++
      }
    } catch (err) {
      errors++
      console.error(`  ERROR creating "${plan.name}": ${err instanceof Error ? err.message : err}`)
    }
  }

  return { created, skipped, errors }
}

// ---------------------------------------------------------------------------
// Seed Programmatic Projects
// ---------------------------------------------------------------------------

async function seedProgrammaticProjects(): Promise<{ created: number; skipped: number; errors: number }> {
  console.log(`\n--- Seeding ${PROGRAMMATIC_PROJECTS.length} Programmatic Projects ---`)

  let created = 0
  let skipped = 0
  let errors = 0

  for (const project of PROGRAMMATIC_PROJECTS) {
    const piDisplay = project.pis.join(', ')
    // Use first PI for author linking
    const primaryFamilyName = extractFamilyName(project.pis[0])
    const authorId = findAuthorByFamilyName(primaryFamilyName)

    const discoveryKeywords = [project.name, ...project.pis.map(extractFamilyName)].join('\n')

    const record: Record<string, unknown> = {
      name: project.name,
      projectType: project.projectType,
      status: 'ongoing',
      pi: piDisplay,
      description: project.description,
      discoveryKeywords,
      autoDiscoveryEnabled: true,
    }

    // piAuthor linking deferred — requires Payload relationship table alignment
    // if (authorId) { record.piAuthor = authorId }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create: "${project.name}" (${project.projectType}, PI: ${piDisplay}${authorId ? ', linked to author ' + authorId : ''})`)
      created++
      continue
    }

    try {
      const existingId = await findByField('projects', 'name', project.name)
      if (existingId) {
        skipped++
        continue
      }

      const result = await createRecord('projects', record)
      if (result) {
        created++
      } else {
        skipped++
      }
    } catch (err) {
      errors++
      console.error(`  ERROR creating "${project.name}": ${err instanceof Error ? err.message : err}`)
    }
  }

  return { created, skipped, errors }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== RMBL Project Seeder ===')
  if (DRY_RUN) console.log('[DRY RUN MODE — no records will be created]')

  // Check server
  if (!DRY_RUN) {
    const serverUp = await checkServer()
    if (!serverUp) {
      console.error('ERROR: Payload dev server is not running. Start it with `npm run dev`.')
      process.exit(1)
    }
    console.log('Payload server is running.')

    await ensureAuth()
    console.log('Authenticated.')
  }

  // Load author cache for PI linking
  if (!DRY_RUN) {
    await loadAuthorCache()
  }

  // Seed research plans
  const rpResult = await seedResearchPlans()

  // Seed programmatic projects
  const ppResult = await seedProgrammaticProjects()

  // Summary
  const totalCreated = rpResult.created + ppResult.created
  const totalSkipped = rpResult.skipped + ppResult.skipped
  const totalErrors = rpResult.errors + ppResult.errors

  console.log('\n=== Summary ===')
  console.log(`Research Plans:        ${rpResult.created} created, ${rpResult.skipped} skipped, ${rpResult.errors} errors`)
  console.log(`Programmatic Projects: ${ppResult.created} created, ${ppResult.skipped} skipped, ${ppResult.errors} errors`)
  console.log(`Total:                 ${totalCreated} created, ${totalSkipped} skipped, ${totalErrors} errors`)

  if (totalErrors > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
