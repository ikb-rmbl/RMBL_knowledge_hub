/**
 * Publication→project links from assign-projects.ts are false-positive-heavy
 * (Ian review, 2026-08-28). Hidden from navigation until assignments are
 * tuned/curated — flip to true to restore the search facet and the project
 * chips on publication detail pages. The project= URL param keeps working;
 * it just isn't linked from anywhere.
 */
export const SHOW_PROJECT_LINKS = false

/**
 * The peer-reviewed-with-student-authors time series on /metrics. Hidden
 * 2026-08-28 (the old windowed inference thinned recent years — a tagging
 * artifact); re-enabled 2026-11-11 once student authorship was rebuilt on
 * RMBL undergraduate-program participants (classify-student-papers.ts +
 * participant tags + legacy Publications DB student markings), reviewed
 * against two labelled samples.
 */
export const SHOW_STUDENT_AUTHOR_SERIES = true
