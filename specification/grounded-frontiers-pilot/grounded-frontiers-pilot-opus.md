# Grounded Frontier Extraction — Stage A Pilot

Model: `claude-opus-4-7`  ·  Papers per neighborhood: 30  ·  Generated: 2026-06-19T23:40:46.787Z

## Headline grounding rates

| Neighborhood | input papers | LLM-emitted | grounded | cite-verify rate |
|---|---:|---:|---:|---:|
| Marmot Life History, Sociality, and Predator Ecology | 17 | 8 | 6 | 78% (7/9) |
| Alpine Plant-Pollinator Interactions and Bee Foraging Ecology | 20 | 9 | 6 | 67% (6/9) |
| High-Altitude Wetland Communities, Salamanders, and Invertebrate Ecology | 21 | 8 | 8 | 100% (9/9) |
| East River Watershed Hydrology and Groundwater Dynamics | 24 | 10 | 10 | 100% (15/15) |
| Mountain Snowpack, Water Balance, and Colorado River Prediction | 16 | 8 | 7 | 90% (9/10) |

---

## Marmot Life History, Sociality, and Predator Ecology
**community_id**: 0  ·  **input papers**: 17  ·  **LLM emitted**: 8  ·  **grounded**: 6

### Statement 1 — open_question (high)

> It remains unresolved whether the propensity to utter alarm calls is heritable across contexts and species, with quantitative genetic data on calling propensity historically lacking.

**Citations** (1):
- **pub #6** [articulates] — *"whether the propensity to utter alarm calls is heritable has not been studied"*

### Statement 2 — open_question (high)

> The heritability of nonlinear phenomena and 'noisiness' in mammalian alarm vocalizations is largely unknown, leaving open whether such fear-encoding acoustic traits can evolve under selection.

**Citations** (1):
- **pub #8** [articulates] — *"there is little research about the heritability of such behavioral traits"*

### Statement 3 — open_question (moderate)

> Annual variation in dispersal, mortality, and recruitment in yellow-bellied marmot societies makes it difficult to produce simple summary statements about society structure and formation, leaving the dynamics of incipient society formation unresolved.

**Citations** (1):
- **pub #5** [articulates] — *"this social variation makes it difficult to make simple summary statements about society structure and formation"*

### Statement 4 — open_question (high)

> Whether and how multilevel selection acts on sociality in wild animals has been a classic but empirically unanswered question, with the relative strength of selection at individual versus group levels in free-living systems still being established.

**Citations** (1):
- **pub #25** [articulates] — *"it is unknown if and how multilevel selection acts on sociality in the wild"*

### Statement 5 — data_gap (high)

> The costs and benefits of dispersal and the factors influencing the dispersal decision are not well characterized in ground-dwelling sciurids, including for golden-mantled ground squirrels where dispersal patterns were largely unknown prior to this work.

**Citations** (2):
- **pub #23** [articulates] — *"the costs and benefits of dispersal, as well as factors influencing the dispersal decision, are not well known"*
- **pub #2273** [reinforces] — *"The inadequacy of dispersal data obtained directly by traditional methods using population studies of marked individuals"*

### Statement 6 — open_question (high)

> Substantial variation in alarm call repertoire size across ground-dwelling sciurids remains unexplained by social complexity, and the alternative drivers of communicative complexity evolution have not been identified.

**Citations** (1):
- **pub #2198** [articulates] — *"substantial variation remained unexplained by social complexity. We acknowledge that factors other than social complexity, per se, may contribute to the evolution of alarm call repertoire size"*

<details><summary>Ungrounded examples (2) — for diagnosis</summary>

- Statement: *"The mechanisms by which early life adversity translates into altered adult glucocorticoid physiology..."*
  - bad cite: pub #22, snippet: *"the mechanisms are still unclear... most animal studies have focused on individu..."*
  - reason: snippet not found verbatim in source
- Statement: *"A general framework for predicting how multiple species respond to human disturbance is lacking, wit..."*
  - bad cite: pub #1729, snippet: *"we lack a general framework to study multiple species... only 21% of studies tha..."*
  - reason: snippet not found verbatim in source

</details>

---

## Alpine Plant-Pollinator Interactions and Bee Foraging Ecology
**community_id**: 40  ·  **input papers**: 20  ·  **LLM emitted**: 9  ·  **grounded**: 6

### Statement 1 — open_question (high)

> How nutrient availability shapes species interactions and nutrient niche dynamics in complex, multispecies wild pollinator assemblages remains poorly understood, as most nutritional ecology work has been confined to laboratory or single-species systems.

**Citations** (1):
- **pub #4** [articulates] — *"how nutrient availability shapes species interactions in natural communities remains poorly understood. Most nutritional ecology research focuses on laboratory or single-species systems, limiting insight into how nutrient use and nutrient niche dynamics occur in complex, multispecies assemblages in the wild"*

### Statement 2 — open_question (high)

> The local-scale, individual-level fitness processes by which climate change drives broad-scale patterns of bee decline are largely unknown.

**Citations** (1):
- **pub #39** [articulates] — *"the local-scale processes that generate these broad-scale patterns are little known. Specifically, it is unclear how climate change influences the fitness of individual bees"*

### Statement 3 — data_gap (high)

> Quantitative data on the actual concentrations of ethanol naturally present in bee dietary sugar sources (honey and foraged floral nectar) are lacking, limiting understanding of yeast-produced ethanol's ecological significance in pollination systems.

**Citations** (1):
- **pub #49** [articulates] — *"little is known about the actual concentrations of ethanol naturally present in the dietary sources of sugar for bees, namely their honey (in the case of eusocial bees) and foraged floral nectar"*

### Statement 4 — data_gap (moderate)

> The foraging preferences of generalist Megachilidae bees are poorly understood, hindering prediction of their responses to climate change in subalpine ecosystems.

**Citations** (1):
- **pub #52** [articulates] — *"Some Megachilidae species are generalists, meaning they visit a wide variety of flower species, but their exact foraging preferences remain poorly understood"*

### Statement 5 — methodological_blocker (high)

> Independent phenological data on pollinator emergence that are not confounded by flowering phenology are scarce, because pollinators are typically collected at flowers, making it difficult to rigorously test phenological mismatch hypotheses.

**Citations** (1):
- **pub #1348** [articulates] — *"there are few data sets on pollinator flight seasons that are independent of flowering phenology, because pollinators are typically collected at flowers"*

### Statement 6 — methodological_blocker (moderate)

> Direct effects of drought on plant reproduction in subalpine wildflowers like Geum triflorum remain inadequately characterized, and current pollinator-exclusion and herbivory-control methods are insufficient to disentangle these effects.

**Citations** (1):
- **pub #61** [articulates] — *"Future research should explore drought effects on reproduction more directly and use improved methods to reduce herbivory and bag failure"*

<details><summary>Ungrounded examples (3) — for diagnosis</summary>

- Statement: *"The role of Syrphidae as pollinators remains controversial and understudied, with a lack of comprehe..."*
  - bad cite: pub #54, snippet: *"addresses the controversy about the efficiency of Syriphidae as pollinators... T..."*
  - reason: snippet not found verbatim in source
- Statement: *"The implications of short-term, competition-driven changes in pollinator foraging specialization for..."*
  - bad cite: pub #1192, snippet: *"These predictions, however, have not been tested empirically and implicitly assu..."*
  - reason: snippet not found verbatim in source
- Statement: *"Because plant-pollinator interaction networks are typically built from temporally aggregated data, t..."*
  - bad cite: pub #799, snippet: *"species interaction networks are typically constructed from tem- porally aggrega..."*
  - reason: snippet not found verbatim in source

</details>

---

## High-Altitude Wetland Communities, Salamanders, and Invertebrate Ecology
**community_id**: 47  ·  **input papers**: 21  ·  **LLM emitted**: 8  ·  **grounded**: 8

### Statement 1 — open_question (high)

> The functional roles and environmental drivers of biofluorescence in salamanders remain poorly understood, including how sunlight exposure modulates its intensity and distribution.

**Citations** (2):
- **pub #50** [articulates] — *"Not much is known about all its functions, more studies are needed to fully understand how it works and how it can be affected by environmental factors."*
- **pub #65** [reinforces] — *"Biofluorescence, the emission of visible light by organisms following the absorption of shorter wavelengths of light, has been identified recently in various amphibians but remains poorly understood in salamanders."*

### Statement 2 — data_gap (high)

> Whether biofluorescence in Arizona tiger salamanders functions as a sexual/reproductive signal is unresolved, and larger datasets with individual-level longitudinal comparisons are needed to test this.

**Citations** (1):
- **pub #65** [articulates] — *"Future analyses will incorporate a larger dataset, individual level comparisons over time, and additional body regions to better understand the biological role of fluorescence in salamander courtship and communication."*

### Statement 3 — data_gap (high)

> The seasonal decline pattern of L. externus caddisfly population density has not been formally tested, leaving baseline density-trajectory data missing for evaluating salamander predation effects.

**Citations** (1):
- **pub #64** [articulates] — *"However this pattern has not been formally tested, so collecting population density data is important for future research and understanding changes in densities over time."*

### Statement 4 — open_question (high)

> It remains unclear how intra- and interspecific interactions shape caddisfly case size across larval development stages.

**Citations** (1):
- **pub #73** [articulates] — *"Case morphology varies with ecological pressures, but gaps remain in understanding how intra- and interspecific interactions influence case size across larval development."*

### Statement 5 — open_question (high)

> The relative fitness of paedomorphic versus metamorphic salamander morphs has not been conclusively determined, limiting understanding of how facultative paedomorphosis evolves and is maintained.

**Citations** (1):
- **pub #2414** [articulates] — *"No study has conclusively determined the relative fitness of paedomorphs and metamorphs, which limits our understanding of the evolution of this polymorphism."*

### Statement 6 — open_question (high)

> How contemporary climate change will alter the selective pressures that maintain phenotypic plasticity and polyphenisms in amphibians is unresolved and requires new studies.

**Citations** (1):
- **pub #98** [articulates] — *"Our findings motivate new studies to determine how contemporary climate change will alter the selective pressures maintaining phenotypic plasticity and polyphenisms."*

### Statement 7 — open_question (moderate)

> The mechanisms maintaining dominance of Limnephilus larvae in permanent caddisfly habitats—hypothesized to be an indirect effect of salamander predation—are not explained by intraguild predation data and remain to be demonstrated.

**Citations** (1):
- **pub #2295** [articulates] — *"These data do not explain the dominance of Limnephilus larvae in permanent basins, which we show elsewhere to be an indirect effect of salamander predation."*

### Statement 8 — open_question (moderate)

> Whether antimicrobial properties of caddisfly silk drive detritivore avoidance and slower decomposition of cases is hypothesized but not yet directly tested.

**Citations** (1):
- **pub #67** [articulates] — *"Insect silk, which often contains antimicrobial peptides or proteins, may be a contributing factor in potential antimicrobial properties and decreased detritivore consumption of cases."*

---

## East River Watershed Hydrology and Groundwater Dynamics
**community_id**: 91  ·  **input papers**: 24  ·  **LLM emitted**: 10  ·  **grounded**: 10

### Statement 1 — open_question (high)

> It remains unclear how the depth of active groundwater circulation in mountain bedrock affects streamflow response to multi-year drought, requiring better characterization of deeper bedrock hydrogeology in mountainous watersheds.

**Citations** (2):
- **pub #11** [articulates] — *"Quantitative understanding is lacking on how the depth of active groundwater circulation in bedrock affects mountain streamflow response to a multi‐year drought"*
- **pub #11** [reinforces] — *"Research highlights the importance of characterizing the deeper bedrock hydrogeology in mountainous watersheds to better understand and predict drought impacts"*

### Statement 2 — open_question (high)

> How interannual climate variability impacts hydrologic connectivity, and consequently streamflow generation and stream chemistry, in montane watersheds remains unresolved.

**Citations** (1):
- **pub #21** [articulates] — *"How interannual climate variability impacts hydrologic connectivity, and thus stream flow generation and chemistry, remains unclear"*

### Statement 3 — open_question (high)

> The processes that dictate observed mixtures of young and old-aged groundwater age distributions in bedrock-underlain mountain catchments are poorly understood.

**Citations** (2):
- **pub #35** [articulates] — *"Field-based studies have found mixtures of young and old-aged groundwater in mountain catchments underlain by bedrock; yet, the processes that dictate these groundwater age distributions are poorly understood"*
- **pub #121** [reinforces] — *"the bedrock groundwater dynamics in mountainous environments are typically under-constrained and excluded from watershed hydrologic models"*

### Statement 4 — open_question (moderate)

> Predicting headwater stream discharge magnitude and peak flow timing remains challenging in mountainous terrains due to the joint influence of vegetation- and elevation-dependent snowmelt rates and heterogeneous subsurface properties.

**Citations** (1):
- **pub #38** [articulates] — *"predicting headwater stream discharge magnitude and peak flow timing is challenging in mountainous terrains, where snowmelt rates vary with vegetation type and elevation, and heterogeneous subsurface physical properties influence groundwater storage and its release"*

### Statement 5 — methodological_blocker (high)

> Observations of high-elevation snowpack dynamics in complex mountain terrain are sparse because of access challenges and the cost/labor intensity of existing methods, creating a methodological blocker for understanding snowmelt progression.

**Citations** (1):
- **pub #116** [articulates] — *"the dynamics of snowmelt progression are not well understood because observations of the high-elevation snowpack are difficult due to challenging access in complex mountainous terrain as well as the cost and labor intensity of currently available methods"*

### Statement 6 — open_question (high)

> Controls on carbon weathering fluxes from shale—and how hydrology regulates ancient rock carbon (Crock) release—remain poorly constrained.

**Citations** (2):
- **pub #119** [articulates] — *"the controls on carbon (C) weathering fluxes remain poorly constrained"*
- **pub #125** [reinforces] — *"Although water is recognized for cycling elements through terrestrial environments, understanding how hydrology controls ancient rock carbon (Crock) release is limited"*

### Statement 7 — methodological_blocker (high)

> Groundwater interactions with mountain streams are often oversimplified or excluded in projections, and explicit incorporation of deeper bedrock groundwater dynamics into watershed hydro-biogeochemical models is needed.

**Citations** (3):
- **pub #88** [articulates] — *"Groundwater interactions with mountain streams are often simplified in model projections, potentially leading to inaccurate estimates of streamflow response to climate change"*
- **pub #35** [reinforces] — *"This dynamic groundwater system amplifies the need to assimilate deeper bedrock groundwater into watershed hydro-biogeochemical predictions"*
- **pub #121** [reinforces] — *"the bedrock groundwater dynamics in mountainous environments are typically under-constrained and excluded from watershed hydrologic models"*

### Statement 8 — open_question (high)

> A mechanistic framework that can interpret the diverse, contrasting concentration-discharge patterns observed across solutes and catchments remains elusive.

**Citations** (1):
- **pub #643** [articulates] — *"Contrasting C‐Q relationships have been observed widely, yet a mechanistic framework that can interpret diverse patterns remains elusive"*

### Statement 9 — open_question (high)

> Subsurface bedrock weathering depths and rates are not well understood nor predictable, requiring integration of porewater chemistry and subsurface flow measurements.

**Citations** (1):
- **pub #641** [articulates] — *"Although bedrock weathering strongly influences water quality and global carbon and nitrogen budgets, the weathering depths and rates within subsurface are not well understood nor predictable"*

### Statement 10 — open_question (moderate)

> The stability of soil viral communities across time and their response to strong seasonal environmental changes in snow-dominated watersheds remains limited, hindering integration of viral impacts into ecosystem biogeochemistry models.

**Citations** (1):
- **pub #187** [articulates] — *"our current understanding of the stability of soil viral communities across time and their response to strong seasonal changes in environmental parameters remains limited"*

---

## Mountain Snowpack, Water Balance, and Colorado River Prediction
**community_id**: 95  ·  **input papers**: 16  ·  **LLM emitted**: 8  ·  **grounded**: 7

### Statement 1 — data_gap (high)

> The magnitude and physical controls of snow sublimation in mountain watersheds remain poorly constrained by observations, driving large divergence in projected Colorado River water availability across models.

**Citations** (2):
- **pub #99** [articulates] — *"Sublimation, the conversion of ice to water vapor, results in less water for runoff, but due to a historic lack of observations, this process is hard to constrain. Variations in how sublimation is represented in models have led to a large divergence of projected water resource availability for the Colorado River basin"*
- **pub #195** [reinforces] — *"Limited observations in complex terrain challenge efforts to improve predictive models of the hydrology in the face of rapid changes. The Upper Colorado River exemplifies these challenges, especially with ongoing mismatches between precipitation, snowpack, and discharge."*

### Statement 2 — methodological_blocker (high)

> Improved seasonal forecasts of spring precipitation in the Upper Colorado headwaters are needed but currently unavailable at the skill required for water availability prediction.

**Citations** (1):
- **pub #96** [articulates] — *"Refining seasonal spring precipitation forecasts is imperative for future water availability predictions in this snow‐dominated water resource region."*

### Statement 3 — open_question (high)

> Cloud radiative forcing impacts on the surface radiation balance over high-elevation snowy mountain terrain are not well understood, limiting our ability to model surface energy budgets in the Upper Colorado River Basin.

**Citations** (1):
- **pub #30** [articulates] — *"However, the impacts of clouds on the surface radiation balance in high elevation snowy mountain terrain are poorly explored."*

### Statement 4 — data_gap (high)

> The extent of aerosol spatiotemporal variability in mountainous complex terrain—and how it should inform measurement network design for cloud-aerosol-precipitation studies—has not previously been quantified.

**Citations** (1):
- **pub #19** [articulates] — *"Previous studies suggest that there is increased aerosol variability in these regions due to their complex terrain, but none of these studies have quantified the extent of this variability."*

### Statement 5 — data_gap (high)

> Precipitation biases in convection-permitting regional climate models over mountain water-resource regions remain poorly characterized due to sparse observations and high spatial variability.

**Citations** (2):
- **pub #216** [articulates] — *"better characterization of precipitation biases is needed, particularly for water-resource-critical mountain regions, where precipitation is highly variable in space, observations are sparse, and the societal water need is great"*
- **pub #114** [reinforces] — *"We fall short of identifying a clearly superior microphysical parameterization but conclude that snow lidar is a valuable nontraditional indicator of model performance."*

### Statement 6 — methodological_blocker (moderate)

> Linear lapse-rate models commonly used to spatialize temperature in mountain hydrology fail in complex terrain, leaving an unresolved methodological need for representing non-linear and inversion-dominated temperature fields.

**Citations** (1):
- **pub #130** [articulates] — *"Linear lapse rate models often perform poorly in complex terrain, with median R² values below 0.5 for temperature variation with elevation"*

### Statement 7 — methodological_blocker (moderate)

> Thermal infrared view-angle biases (e.g., shadow-hiding effects) in geostationary satellite observations of snow- and forest-covered surfaces are not fully characterized, limiting use of GOES-R land surface temperatures in mountain snow applications.

**Citations** (1):
- **pub #4955** [articulates] — *"These biases are important to understand for applications using GOES-R brightness temperatures or derived land surface temperatures (LSTs) over areas with surface roughness features, such as forests, that could exhibit a thermal infrared shadow-hiding effect."*

<details><summary>Ungrounded examples (1) — for diagnosis</summary>

- Statement: *"Climate model projections of the North American Monsoon response to warming remain divergent and unc..."*
  - bad cite: pub #412, snippet: *"The response of summer precipitation in the western United States to climate var..."*
  - reason: snippet not found verbatim in source

</details>
