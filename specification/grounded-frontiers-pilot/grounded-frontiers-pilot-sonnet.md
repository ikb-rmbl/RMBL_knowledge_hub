# Grounded Frontier Extraction — Stage A Pilot

Model: `claude-sonnet-4-6`  ·  Papers per neighborhood: 30  ·  Generated: 2026-06-19T23:34:39.998Z

## Headline grounding rates

| Neighborhood | input papers | LLM-emitted | grounded | cite-verify rate |
|---|---:|---:|---:|---:|
| Marmot Life History, Sociality, and Predator Ecology | 17 | 8 | 7 | 92% (12/13) |
| Alpine Plant-Pollinator Interactions and Bee Foraging Ecology | 20 | 9 | 6 | 70% (7/10) |
| High-Altitude Wetland Communities, Salamanders, and Invertebrate Ecology | 21 | 8 | 8 | 100% (12/12) |
| East River Watershed Hydrology and Groundwater Dynamics | 24 | 9 | 9 | 93% (13/14) |
| Mountain Snowpack, Water Balance, and Colorado River Prediction | 16 | 9 | 9 | 94% (17/18) |

---

## Marmot Life History, Sociality, and Predator Ecology
**community_id**: 0  ·  **input papers**: 17  ·  **LLM emitted**: 8  ·  **grounded**: 7

### Statement 1 — open_question (high)

> Whether the propensity to alarm-call is heritable across contexts beyond trapping and natural elicitation remains unknown, as the genetic correlation between these two measured contexts is small and may not generalize to other situations.

**Citations** (1):
- **pub #6** [articulates] — *"There was a small but significant genetic correlation between these traits (0.338). Together, these results show that the propensity to utter alarm calls is individually variable and context dependent and can evolve in response to natural selection."*

### Statement 2 — open_question (high)

> It remains unresolved whether and how multilevel selection acts on sociality in the wild, specifically whether antagonistic selection gradients at individual versus group levels explain the limited heritability and fitness benefits of sociality in marmots compared with other taxa.

**Citations** (2):
- **pub #25** [articulates] — *"Though social behaviours are a common theoretical example for multilevel selection, it is unknown if and how multilevel selection acts on sociality in the wild."*
- **pub #25** [reinforces] — *"We also found antagonistic multilevel selection gradients within and between levels, potentially explaining why increased sociality is not as beneficial or heritable in this system compared with other social taxa."*

### Statement 3 — open_question (high)

> The factors other than social complexity that contribute to the evolution of alarm call repertoire size in sciurid rodents remain unidentified, as substantial variation in repertoire size is unexplained after accounting for sociality and phylogeny.

**Citations** (2):
- **pub #2198** [articulates] — *"We acknowledge that factors other than social complexity, per se, may contribute to the evolution of alarm call repertoire size in sciurid rodents, and we discuss alternative hypotheses."*
- **pub #2198** [reinforces] — *"In most cases, substantial variation remained unexplained by social complexity."*

### Statement 4 — open_question (high)

> The precise conditions under which stressed marmots produce less noisy calls despite higher arousal—and how glucocorticoid-mediated vocal production interacts with the nonlinearity and fear hypothesis—remain unresolved, as animals with higher FGM levels produced more structured, less noisy calls contrary to simple stress-noise predictions.

**Citations** (2):
- **pub #3** [articulates] — *"animals that were likely under greater stress (as measured with faecal glucocorticoid metabolites) produced more structured and less noisy calls"*
- **pub #8** [reinforces] — *"While much is known about the conditions under which animals produce vocalizations containing NLP and how species respond to them, there is little research about the heritability of such behavioral traits."*

### Statement 5 — data_gap (high)

> The costs and benefits of dispersal—and the factors influencing the dispersal decision—are not well known for most ground-dwelling sciurids, and traditional mark-recapture methods systematically underestimate dispersal distances compared with radio-tracking and genetic approaches.

**Citations** (2):
- **pub #23** [articulates] — *"However, the costs and benefits of dispersal, as well as factors influencing the dispersal decision, are not well known."*
- **pub #2273** [reinforces] — *"The inadequacy of dispersal data obtained directly by traditional methods using population studies of marked individuals is highlighted by comparing the resulting distributions with dispersal estimates obtained by radio-tracking and by using genetic estimates of gene flow."*

### Statement 6 — open_question (high)

> Outstanding questions about marmot society formation and structure persist because the species' facultative sociality and annual variation in social composition make it difficult to make simple summary statements, and a general framework for studying incipient society formation across populations is lacking.

**Citations** (2):
- **pub #5** [articulates] — *"Because of their facultative sociality and because we have studied social behaviour and societies a variety of different of ways over the years, this social variation makes it difficult to make simple summary statements about society structure and formation."*
- **pub #5** [reinforces] — *"None the less, this variation may make them a good system in which to study incipient society formation."*

### Statement 7 — methodological_blocker (moderate)

> A general predictive framework for how animals integrate multiple sensory modalities under ecological uncertainty is lacking, and empirical support from natural systems for multisensory perception is rarely placed within an adaptive framework.

**Citations** (1):
- **pub #1294** [articulates] — *"Despite the ecological relevance of multisensory perception in helping animals cope with uncertainty, empirical support from natural systems is rarely placed within an adaptive framework."*

<details><summary>Ungrounded examples (1) — for diagnosis</summary>

- Statement: *"The causal mechanisms linking early life adversity to adult glucocorticoid levels in wild mammals re..."*
  - bad cite: pub #22, snippet: *"However, the mechanisms are still unclear. Some have found that early life adver..."*
  - reason: snippet not found verbatim in source

</details>

---

## Alpine Plant-Pollinator Interactions and Bee Foraging Ecology
**community_id**: 40  ·  **input papers**: 20  ·  **LLM emitted**: 9  ·  **grounded**: 6

### Statement 1 — open_question (high)

> It remains unresolved how nutrient niche breadth among wild bumble bee species is determined, as the study found little evidence that it was explained by feeding morphology or colony life stage.

**Citations** (1):
- **pub #4** [articulates] — *"We found little evidence that nutrient niche breadth differed among species or was explained by feeding morphology or colony life stage."*

### Statement 2 — open_question (high)

> The local-scale individual-level processes by which climate change influences bee fitness are poorly known, despite being the mechanistic foundation of broad-scale population declines.

**Citations** (1):
- **pub #39** [articulates] — *"it is unclear how climate change influences the fitness of individual bees, despite the fact that broad-scale patterns of decline must be driven by individual-level processes."*

### Statement 3 — open_question (high)

> The ecological significance of ethanol naturally present in floral nectar and bee honey for pollinator behavior remains largely unknown, as little is known about actual concentrations of ethanol in dietary sugar sources for bees in the wild.

**Citations** (1):
- **pub #49** [articulates] — *"little is known about the actual concentrations of ethanol naturally present in the dietary sources of sugar for bees, namely their honey (in the case of eusocial bees) and foraged floral nectar."*

### Statement 4 — methodological_blocker (moderate)

> The reproductive ecology and pollination dependency of Geum triflorum under drought conditions cannot be statistically resolved with existing data, as severe drought, herbivory, and bag failures precluded adequate seed set for analysis.

**Citations** (2):
- **pub #61** [articulates] — *"due to severe drought stress, widespread herbivory, and issues with pollinator exclusion bags, only three flowers produced seeds across all treatments. This precluded statistical analysis of reproductive success."*
- **pub #61** [reinforces] — *"Future research should explore drought effects on reproduction more directly and use improved methods to reduce herbivory and bag failure."*

### Statement 5 — open_question (high)

> Whether plant communities will be as resilient to pollinator species loss as simulation models predict remains empirically untested, because those models implicitly assume pollination efficacy is unaffected by interspecific competition among remaining pollinators.

**Citations** (1):
- **pub #1192** [articulates] — *"Simulation models of pollination networks suggest that plant communities will be resilient to losing many or even most of the pollinator species in an ecosystem. These predictions, however, have not been tested empirically and implicitly assume that pollination efficacy is unaffected by interactions with interspecific competitors."*

### Statement 6 — data_gap (high)

> Detailed phenological data on pollinator flight seasons independent of flowering phenology are scarce, because pollinators are typically collected at flowers, making it difficult to rigorously test for phenological mismatch between plants and pollinators.

**Citations** (1):
- **pub #1348** [articulates] — *"there are few data sets on pollinator flight seasons that are independent of flowering phenology, because pollinators are typically collected at flowers."*

<details><summary>Ungrounded examples (3) — for diagnosis</summary>

- Statement: *"Whether non-native floral resources like Taraxacum officinale function as ecological traps for nativ..."*
  - bad cite: pub #7, snippet: *"survival costs may negate the potential fitness benefits of early nesting, indic..."*
  - reason: snippet not found verbatim in source
- Statement: *"The exact foraging preferences of generalist Megachilidae species remain poorly understood, limiting..."*
  - bad cite: pub #52, snippet: *"Some Megachilidae species are generalists, meaning they visit a wide variety of ..."*
  - reason: snippet not found verbatim in source
- Statement: *"The comprehensive role of Syrphidae as pollinators is unresolved due to a lack of comprehensive stud..."*
  - bad cite: pub #54, snippet: *"This research has the potential to significantly contribute to the field of ento..."*
  - reason: snippet not found verbatim in source

</details>

---

## High-Altitude Wetland Communities, Salamanders, and Invertebrate Ecology
**community_id**: 47  ·  **input papers**: 21  ·  **LLM emitted**: 8  ·  **grounded**: 8

### Statement 1 — open_question (high)

> The relative fitness of paedomorphic versus metamorphic salamanders has not been conclusively determined, leaving the evolutionary maintenance of facultative paedomorphosis incompletely explained.

**Citations** (2):
- **pub #2414** [articulates] — *"No study has conclusively determined the relative fitness of paedomorphs and metamorphs, which limits our understanding of the evolution of this polymorphism."*
- **pub #98** [reinforces] — *"Our findings motivate new studies to determine how contemporary climate change will alter the selective pressures maintaining phenotypic plasticity and polyphenisms."*

### Statement 2 — open_question (high)

> The biological functions of biofluorescence in salamanders—including its potential roles in courtship, communication, and as an indicator of reproductive state—remain poorly understood, with current data insufficient to confirm links between fluorescence and sexual readiness.

**Citations** (2):
- **pub #50** [articulates] — *"Not much is known about all its functions, more studies are needed to fully understand how it works and how it can be affected by environmental factors."*
- **pub #65** [reinforces] — *"These findings suggest a morph-specific difference in tail biofluorescence, with other potential sexual or reproductive signals warranting farther study. Future analyses will incorporate a larger dataset, individual level comparisons over time, and additional body regions to better understand the biological role of fluorescence in salamander courtship and communication."*

### Statement 3 — open_question (moderate)

> It is unresolved whether the observed decline in L. externus population density over summer months is formally driven by salamander predation, as this pattern has not been statistically tested across ponds with and without salamanders.

**Citations** (1):
- **pub #64** [articulates] — *"The caddisfly L. externus has been observed to have a decline in population density over the summer months as the larvae develop. However this pattern has not been formally tested, so collecting population density data is important for future research and understanding changes in densities over time."*

### Statement 4 — open_question (moderate)

> The antimicrobial mechanisms potentially protecting caddisfly cases from decomposition—specifically whether insect silk antimicrobial peptides or proteins are responsible—have not been empirically tested, and fungal community data from cases currently lack statistical analysis.

**Citations** (2):
- **pub #67** [articulates] — *"Insect silk, which often contains antimicrobial peptides or proteins, may be a contributing factor in potential antimicrobial properties and decreased detritivore consumption of cases."*
- **pub #67** [reinforces] — *"Figures 8 and 9, no statistical analysis of fungal data provided"*

### Statement 5 — open_question (moderate)

> The mechanisms by which predator identity (e.g., Dytiscus beetles versus salamanders) differentially shapes caddisfly case size and behavioral plasticity across source populations remain unresolved, as the relative contributions of predator type versus intraspecific competition have not been disentangled.

**Citations** (1):
- **pub #73** [articulates] — *"These results demonstrate that case size reflects integrated responses to predator identity (e.g., Dytiscus beetles in LSD ponds), intraspecific competition, and source-population adaptations, with behavioral plasticity compensating for structural defenses in HSD environments."*

### Statement 6 — data_gap (moderate)

> Long-term data linking salamander life-history strategies (metamorphic vs. paedomorphic morph ratios) to elevation-specific climate variables are incomplete, as ongoing surveys needed to test elevation-dependent growth and morph outcomes have not yet been fully analyzed.

**Citations** (2):
- **pub #48** [articulates] — *"Findings will be compared with climate data at each site and added to the ongoing 2020-2024 dataset."*
- **pub #89** [reinforces] — *"In paedomorphs, senescence rate and adult lifespan also varied among ponds and individuals."*

### Statement 7 — data_gap (moderate)

> The hatching cues and maturation state of fairy shrimp eggs at the time of salamander ingestion are insufficiently characterized, leaving the estimate of salamander-mediated dispersal rates uncertain across the reproductive period of Branchinecta coloradensis.

**Citations** (1):
- **pub #2073** [articulates] — *"Results of a third experimental treatment suggested that the eggs being carried by females were not fully mature, so that ingestion resistance might vary throughout the reproductive period of B. coloradensis."*

### Statement 8 — open_question (high)

> The individual- and pond-level sources of variation in senescence rate among paedomorphic salamanders are unresolved, with current knowledge described as 'still very fragmentary' regarding how phenotypic plasticity affects senescence rate in nature.

**Citations** (1):
- **pub #89** [articulates] — *"Phenotypic plasticity likely plays a central role in among-individual heterogeneity in senescence rate (i.e. the rate of increase in mortality with age), although our knowledge on this subject is still very fragmentary."*

---

## East River Watershed Hydrology and Groundwater Dynamics
**community_id**: 91  ·  **input papers**: 24  ·  **LLM emitted**: 9  ·  **grounded**: 9

### Statement 1 — open_question (high)

> How interannual climate variability impacts hydrologic connectivity, and thus stream flow generation and chemistry, remains unclear in montane headwater catchments.

**Citations** (1):
- **pub #21** [articulates] — *"How interannual climate variability impacts hydrologic connectivity, and thus stream flow generation and chemistry, remains unclear."*

### Statement 2 — data_gap (high)

> Quantitative understanding is lacking on how the depth of active groundwater circulation in bedrock affects mountain streamflow response to a multi-year drought, particularly with respect to characterizing deeper bedrock hydrogeology in mountainous watersheds.

**Citations** (2):
- **pub #11** [articulates] — *"Quantitative understanding is lacking on how the depth of active groundwater circulation in bedrock affects mountain streamflow response to a multi‐year drought."*
- **pub #11** [reinforces] — *"Research highlights the importance of characterizing the deeper bedrock hydrogeology in mountainous watersheds to better understand and predict drought impacts on stream ecosystem health and water resource sustainability."*

### Statement 3 — open_question (high)

> The processes that dictate groundwater age distributions in mountain catchments underlain by bedrock—particularly the interplay between advective transport and matrix diffusion—are poorly understood and require better characterization of fracture and matrix parameters.

**Citations** (2):
- **pub #35** [articulates] — *"Field-based studies have found mixtures of young and old-aged groundwater in mountain catchments underlain by bedrock; yet, the processes that dictate these groundwater age distributions are poorly understood."*
- **pub #35** [reinforces] — *"This work further highlights the importance of considering matrix diffusion when interpreting environmental tracers in bedrock groundwater systems."*

### Statement 4 — data_gap (high)

> The bedrock groundwater dynamics in mountainous environments are typically under-constrained and excluded from watershed hydrologic models, representing a critical data gap for accurately predicting watershed response to perturbations such as drought.

**Citations** (2):
- **pub #121** [articulates] — *"Yet, the bedrock groundwater dynamics in mountainous environments are typically under-constrained and excluded from watershed hydrologic models."*
- **pub #88** [reinforces] — *"Groundwater interactions with mountain streams are often simplified in model projections, potentially leading to inaccurate estimates of streamflow response to climate change."*

### Statement 5 — methodological_blocker (high)

> The dynamics of snowmelt progression from high-elevation snowpack are not well understood because observations are difficult due to challenging access in complex mountainous terrain as well as the cost and labor intensity of currently available methods.

**Citations** (1):
- **pub #116** [articulates] — *"the dynamics of snowmelt progression are not well understood because observations of the high-elevation snowpack are difficult due to challenging access in complex mountainous terrain as well as the cost and labor intensity of currently available methods."*

### Statement 6 — open_question (high)

> The controls on carbon weathering fluxes from shale remain poorly constrained, particularly how diffusion-limited gas transport under transient hydrological conditions affects inferences about soil CO2 drawdown.

**Citations** (1):
- **pub #119** [articulates] — *"the controls on carbon (C) weathering fluxes remain poorly constrained."*

### Statement 7 — open_question (moderate)

> A mechanistic framework that can interpret diverse concentration-discharge patterns across catchments remains elusive, as the subsurface biogeochemical heterogeneity governing source water chemistry contrasts and their regulation of C-Q slopes is not yet predictable across diverse geologic and climatic settings.

**Citations** (1):
- **pub #643** [articulates] — *"Contrasting C‐Q relationships have been observed widely, yet a mechanistic framework that can interpret diverse patterns remains elusive."*

### Statement 8 — coordination_gap (moderate)

> The global soil virosphere remains under-characterized, and integrating viral impacts into complex natural microbiome models—needed to accurately predict ecosystem biogeochemistry—has not yet been achieved.

**Citations** (2):
- **pub #187** [articulates] — *"As our understanding of how environmental and host factors drive viral activity in soil ecosystems progresses, integrating these viral impacts in complex natural microbiome models will be key to accurately predict ecosystem biogeochemistry."*
- **pub #187** [reinforces] — *"we identified a large number of DNA and RNA viruses taxonomically divergent from existing environmental viruses, including a significant proportion of fungal RNA viruses, and a large and unsuspected diversity of positive single-stranded RNA phages (Leviviricetes), highlighting the under-characterization of the global soil virosphere."*

### Statement 9 — open_question (moderate)

> Whether well-coupled plant-mycorrhizal phenology currently buffers ecosystem nitrogen losses in spring, and how changes in snowmelt timing may alter ecosystem nitrogen retention potential, remains unresolved.

**Citations** (1):
- **pub #544** [articulates] — *"If well-coupled plant-mycorrhizal phenology currently buffers ecosystem N losses in spring, then changes in snowmelt timing may alter ecosystem N retention potential."*

<details><summary>Ungrounded examples (1) — for diagnosis</summary>

- Statement: *"The controls on carbon weathering fluxes from shale remain poorly constrained, particularly how diff..."*
  - bad cite: pub #119, snippet: *"Diffusion-limited transport of gases under transient hydrological conditions exe..."*
  - reason: snippet not found verbatim in source

</details>

---

## Mountain Snowpack, Water Balance, and Colorado River Prediction
**community_id**: 95  ·  **input papers**: 16  ·  **LLM emitted**: 9  ·  **grounded**: 9

### Statement 1 — open_question (high)

> It remains unresolved how sublimation rates will change under future climate conditions, and current model representations of sublimation diverge so greatly that projected water resource availability for the Colorado River basin is highly uncertain across both current and future climates.

**Citations** (2):
- **pub #99** [articulates] — *"Variations in how sublimation is represented in models have led to a large divergence of projected water resource availability for the Colorado River basin over both current and future climates."*
- **pub #99** [reinforces] — *"sublimation may remove 10%–90% of snowfall from the system"*

### Statement 2 — data_gap (high)

> The extent and drivers of spatiotemporal aerosol variability in complex mountain terrain are poorly quantified, and it is unknown how this variability affects aerosol–cloud interactions and ultimately precipitation and streamflow in regions like the Upper Colorado River Basin.

**Citations** (2):
- **pub #19** [articulates] — *"Previous studies suggest that there is increased aerosol variability in these regions due to their complex terrain, but none of these studies have quantified the extent of this variability."*
- **pub #19** [reinforces] — *"These data and analyses serve as a valuable resource for continued research into the role of aerosols in the hydrologic cycle and as the foundation for designing measurement networks in complex terrain."*

### Statement 3 — open_question (high)

> The impacts of clouds on the surface radiation balance in high-elevation snowy mountain terrain are poorly understood, leaving the role of cloud radiative forcing in driving snowpack evolution and streamflow generation unresolved.

**Citations** (2):
- **pub #30** [articulates] — *"the impacts of clouds on the surface radiation balance in high elevation snowy mountain terrain are poorly explored"*
- **pub #30** [reinforces] — *"The results suggest that net CRF will increase in magnitude and lead to a more persistent cooling effect on the surface net radiation budget as the snow cover declines."*

### Statement 4 — methodological_blocker (high)

> No clearly superior microphysical parameterization for simulating cold-season precipitation and snowpack accumulation in the Colorado Rockies has been identified, leaving model selection for water resource applications without clear guidance.

**Citations** (2):
- **pub #114** [articulates] — *"We fall short of identifying a clearly superior microphysical parameterization but conclude that snow lidar is a valuable nontraditional indicator of model performance."*
- **pub #114** [reinforces] — *"microphysical parameterization choice alone has a modest impact on total precipitation on the order of ±3% watershed-wide, and as high as 15% for certain regions"*

### Statement 5 — open_question (high)

> Seasonal spring precipitation forecasts for the Upper Colorado River Basin remain insufficiently refined, leaving a critical gap in the ability to predict future water availability in this snow-dominated region.

**Citations** (1):
- **pub #96** [reinforces] — *"Combining spring precipitation decreases with PET increases accounted for 67% of the variance in post‐2000 streamflow deficits."*

### Statement 6 — data_gap (high)

> Gridded precipitation datasets used to characterize high-elevation precipitation biases in regional climate models show differences on the order of ±20%, and sparse SNOTEL gauge networks limit conclusions that can be drawn, leaving precipitation estimation at the highest elevations poorly constrained.

**Citations** (2):
- **pub #216** [articulates] — *"Regional comparisons between WRF precipitation accumulation and three different gridded datasets show differences on the order of ± 20 %, particularly at the highest elevations and in keeping with findings from other studies."*
- **pub #216** [reinforces] — *"the low-resolution or SNOTEL gauges limit some of the conclusions that can be drawn"*

### Statement 7 — open_question (moderate)

> The coupling mechanisms between valley-scale thermally driven winds and upper-level winds in high-altitude complex terrain are not fully understood, particularly how forced channeling operates when the convective boundary layer grows above ridge height, leaving valley wind predictability unresolved.

**Citations** (2):
- **pub #1** [articulates] — *"We link differences in valley wind evolution to wind direction at upper levels at and above ridge height and propose forced channeling mechanisms to describe coupling between valley and upper‐level wind when the CBL grows above ridge height."*
- **pub #1** [reinforces] — *"The deep CBL is supported by the presence of a deep weakly stably stratified residual layer with high aerosol content, which is regularly present over the mountain range during the warm season."*

### Statement 8 — methodological_blocker (moderate)

> Linear temperature lapse rate models perform poorly in complex terrain (median R² below 0.5), and it is unresolved what modeling approaches can adequately represent surface temperature variability—including cold air pooling and aspect-driven heating—across mountain watersheds for hydrological applications.

**Citations** (2):
- **pub #130** [articulates] — *"Linear lapse rate models often perform poorly in complex terrain, with median R² values below 0.5 for temperature variation with elevation"*
- **pub #130** [reinforces] — *"Three main patterns govern temperature variability: overall warming relative to 600 hPa level (EOF 1, 50.9% variance), cold air pooling in valleys (EOF 2, 9.3% variance), and aspect-related diurnal heating (EOF 3, 6.8% variance)"*

### Statement 9 — coordination_gap (moderate)

> Improving predictive models of mountain hydrology—spanning precipitation, snowpack, and discharge—requires coordinated integration across atmospheric, surface, and subsurface disciplines, but ongoing mismatches between these components in the Upper Colorado River Basin remain unresolved.

**Citations** (2):
- **pub #195** [articulates] — *"The science of mountainous hydrology spans the atmosphere through the bedrock and inherently crosses physical and disciplinary boundaries: land–atmosphere interactions in complex terrain enhance clouds and precipitation, while watersheds retain and release water over a large range of spatial and temporal scales."*
- **pub #195** [reinforces] — *"especially with ongoing mismatches between precipitation, snowpack, and discharge"*

<details><summary>Ungrounded examples (1) — for diagnosis</summary>

- Statement: *"Seasonal spring precipitation forecasts for the Upper Colorado River Basin remain insufficiently ref..."*
  - bad cite: pub #96, snippet: *"Refining seasonal spring precipitation forecasts is imperative for future water ..."*
  - reason: snippet not found verbatim in source

</details>
