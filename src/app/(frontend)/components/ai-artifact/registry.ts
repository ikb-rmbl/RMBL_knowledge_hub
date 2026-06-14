/**
 * Registry of Tier 1 LLM-generated artifact types — the kinds where the
 * artifact is LLM-authored prose, not just structured fields.
 *
 * Each entry carries:
 *   - kind:           machine name for the type
 *   - label:          short noun phrase for the disclaimer header
 *   - description:    one-sentence framing of what the artifact is
 *   - readingFraming: one-sentence framing of how to read it (what it is, what it isn't)
 *   - methodologyAnchor: anchor on /about that explains the pipeline
 *   - scriptPath:     GitHub path to the generation script (provenance link)
 *
 * The shared components (Disclaimer, ProvenanceSidebar) take an artifact
 * `kind` and look the copy up here. Detail pages stay thin.
 *
 * Tier 2 + 3 artifacts (classifications, embeddings, etc.) live elsewhere;
 * this registry is intentionally narrow to Tier 1.
 */

export type Tier1Artifact =
  | 'neighborhood-primer'
  | 'era-primer'
  | 'frontier-synthesis'
  | 'planning-cluster-description'
  | 'planning-theme-description'
  | 'long-reach-opportunity-synthesis'
  | 'future-scenario'
  | 'future-scenario-story'

export interface ArtifactCopy {
  kind: Tier1Artifact
  label: string
  description: string
  readingFraming: string
  methodologyAnchor: string
  scriptPath: string
  /**
   * GitHub URL with line anchor pointing at the prompt template the script
   * sends to the LLM. Linking the actual prompt closes the transparency
   * loop — readers can see exactly what context the model received.
   */
  promptUrl: string
}

const REPO = 'https://github.com/ikb-rmbl/RMBL_knowledge_hub/blob/main'

export const ARTIFACT_REGISTRY: Record<Tier1Artifact, ArtifactCopy> = {
  'neighborhood-primer': {
    kind: 'neighborhood-primer',
    label: 'neighborhood primer',
    description:
      "An AI-synthesized research primer that reads the publications, datasets, and documents tagged as this neighborhood's members and summarizes the work as a brief literature-review-style narrative.",
    readingFraming:
      "Read it as a starting point — a synthesized map of what is in this neighborhood and how it connects, not as a peer-reviewed literature review. Cited papers are grounded; the synthesis is the model's reading of them.",
    methodologyAnchor: 'neighborhood-primers-methodology',
    scriptPath: 'scripts/generate-primers.ts',
    promptUrl: `${REPO}/scripts/generate-primers.ts#L42-L142`,
  },
  'era-primer': {
    kind: 'era-primer',
    label: 'era primer',
    description:
      'An AI-synthesized period primer that reads the publications and documents from a defined era of basin science and summarizes the dominant questions, methods, and findings.',
    readingFraming:
      'Read it as a synthesized characterization of a research period, not as an authoritative history. Specific publications cited are grounded; the period framing is the model\'s reading.',
    methodologyAnchor: 'era-primers-methodology',
    scriptPath: 'scripts/generate-era-primers.ts',
    promptUrl: `${REPO}/scripts/generate-era-primers.ts#L87-L153`,
  },
  'frontier-synthesis': {
    kind: 'frontier-synthesis',
    label: 'frontier synthesis',
    description:
      "An AI-synthesized knowledge-frontier description that clusters gap statements from research neighborhoods and articulates them as a single named frontier — with key questions, concrete actions, and data gaps.",
    readingFraming:
      "Read it as a synthesized articulation of where the literature points toward a knowledge boundary, not as an authoritative research agenda. The neighborhoods clustered to form it are listed; the synthesis is the model's reading of their gap statements.",
    methodologyAnchor: 'frontier-syntheses-methodology',
    scriptPath: 'scripts/synthesize-frontiers.ts',
    promptUrl: `${REPO}/scripts/synthesize-frontiers.ts#L93`,
  },
  'planning-cluster-description': {
    kind: 'planning-cluster-description',
    label: 'planning cluster description',
    description:
      'An AI-synthesized title and summary for a cluster of frontier planning items (actions, questions, data gaps, barriers, or impacts) grouped by Louvain detection over their embeddings.',
    readingFraming:
      'Read it as a synthesis of what a cluster of related items collectively articulates, not as an authoritative recommendation.',
    methodologyAnchor: 'planning-clusters-methodology',
    scriptPath: 'scripts/describe-frontier-planning-clusters.ts',
    promptUrl: `${REPO}/scripts/describe-frontier-planning-clusters.ts#L45`,
  },
  'planning-theme-description': {
    kind: 'planning-theme-description',
    label: 'planning theme synthesis',
    description:
      'An AI-synthesized cross-lens planning theme that connects clusters of related planning items into an invitational opportunity statement for board and leadership conversation.',
    readingFraming:
      'Read it as an invitational framing for planning conversation, not as a board commitment or strategic plan.',
    methodologyAnchor: 'planning-themes-methodology',
    scriptPath: 'scripts/describe-planning-themes.ts',
    promptUrl: `${REPO}/scripts/describe-planning-themes.ts#L44`,
  },
  'long-reach-opportunity-synthesis': {
    kind: 'long-reach-opportunity-synthesis',
    label: 'long-reach opportunity',
    description:
      'An AI-synthesized strategic opportunity statement drawing across multiple planning themes to surface basin-science contributions that scale beyond the basin.',
    readingFraming:
      'Read it as a synthesis of cross-theme strategic possibility, not as an institutional commitment or campaign deliverable.',
    methodologyAnchor: 'long-reach-opportunities-methodology',
    scriptPath: 'scripts/synthesize-long-reach-opportunities.ts',
    promptUrl: `${REPO}/scripts/synthesize-long-reach-opportunities.ts#L30`,
  },
  'future-scenario': {
    kind: 'future-scenario',
    label: 'future scenario',
    description:
      'An AI-drafted planning artifact describing one plausible state of basin science roughly fifteen years from now, under specified conditions. Part of a set that maps a strategic decision space.',
    readingFraming:
      "Read it as one of several scenarios the framework explores — a planning artifact, not a forecast or RMBL institutional commitment. The contingencies the scenario depends on are named explicitly.",
    methodologyAnchor: 'futures-methodology',
    scriptPath: 'scripts/generate-scenarios.ts',
    promptUrl: `${REPO}/scripts/generate-scenarios.ts#L86`,
  },
  'future-scenario-story': {
    kind: 'future-scenario-story',
    label: 'future scenario story',
    description:
      'Short literary fiction grounded in a specific future scenario. Characters are fictional roles, not real RMBL staff or guest scientists.',
    readingFraming:
      'Read it as fiction — a companion artifact to its scenario, designed to help readers inhabit a possible future at a register strategic-planning artifacts cannot reach. Not documentary; not prediction.',
    methodologyAnchor: 'futures-methodology',
    scriptPath: 'scripts/generate-stories.ts',
    promptUrl: `${REPO}/scripts/generate-stories.ts#L118`,
  },
}
