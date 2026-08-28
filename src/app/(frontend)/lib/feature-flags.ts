/**
 * Publication→project links from assign-projects.ts are false-positive-heavy
 * (Ian review, 2026-08-28). Hidden from navigation until assignments are
 * tuned/curated — flip to true to restore the search facet and the project
 * chips on publication detail pages. The project= URL param keeps working;
 * it just isn't linked from anywhere.
 */
export const SHOW_PROJECT_LINKS = false

/**
 * The peer-reviewed-with-student-authors time series declines after 2019
 * (26→5 by 2025) while student papers hold steady — a tagging artifact
 * (windowed inference thins for recent years), not a real trend (Ian,
 * 2026-08-28). Series hidden from the /metrics chart until tagging improves
 * (REU roster, better author linking); the KPI tile and CSV column remain.
 */
export const SHOW_STUDENT_AUTHOR_SERIES = false
