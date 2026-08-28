/**
 * Publication→project links from assign-projects.ts are false-positive-heavy
 * (Ian review, 2026-08-28). Hidden from navigation until assignments are
 * tuned/curated — flip to true to restore the search facet and the project
 * chips on publication detail pages. The project= URL param keeps working;
 * it just isn't linked from anywhere.
 */
export const SHOW_PROJECT_LINKS = false
