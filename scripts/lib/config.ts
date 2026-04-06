/**
 * Centralized configuration for all pipeline scripts.
 *
 * All constants that were previously scattered across scripts
 * are consolidated here, with environment variable overrides.
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const OUTPUT_DIR = join(__dirname, '..', 'output')
export const STAGING_DIR = join(OUTPUT_DIR, 'pdf-staging')

// ---------------------------------------------------------------------------
// Payload CMS
// ---------------------------------------------------------------------------

export const PAYLOAD_BASE_URL = process.env.PAYLOAD_BASE_URL || 'http://localhost:3000'
export const PAYLOAD_API = `${PAYLOAD_BASE_URL}/api`
export const PAYLOAD_ADMIN_EMAIL = process.env.PAYLOAD_ADMIN_EMAIL || 'admin@rmbl.org'
export const PAYLOAD_ADMIN_PASSWORD = process.env.PAYLOAD_ADMIN_PASSWORD || 'dev-password-change-me'

// ---------------------------------------------------------------------------
// External APIs
// ---------------------------------------------------------------------------

export const CROSSREF_API = 'https://api.crossref.org/works'
export const CROSSREF_MAILTO = process.env.CROSSREF_MAILTO || 'knowledgehub@rmbl.org'

export const UNPAYWALL_API = 'https://api.unpaywall.org/v2'
export const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL || 'knowledgehub@rmbl.org'

export const RMBL_PUBS_API = 'https://www.rmbl.org/wp-json/rmbl-pubs/v1/library'
export const RMBL_CATALOG_API = 'https://www.rmbl.org/wp-json/rmbl-data-catalog/v1/catalog?take=500&skip=0&filter%5Bfilters%5D%5B0%5D%5Bfield%5D=id&filter%5Bfilters%5D%5B0%5D%5Boperator%5D=gte&filter%5Bfilters%5D%5B0%5D%5Bvalue%5D=1'
export const SUST_LIB_AJAX = 'https://sustainablelibrary.org/wp-admin/admin-ajax.php'

export const OPENALEX_API = 'https://api.openalex.org'
export const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO || 'knowledgehub@rmbl.org'

export const DATACITE_API = 'https://api.datacite.org/dois'

export const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || ''
export const VOYAGE_MODEL = 'voyage-4'
export const EMBEDDING_DIMENSIONS = 1024

// ---------------------------------------------------------------------------
// Concurrency & Rate Limiting Defaults
// ---------------------------------------------------------------------------

export const CONCURRENCY = {
  PDF_DOWNLOAD: 5,
  PDF_EXTRACT: 2,
  API_CALLS: 3,
  DETAIL_PAGES: 5,
  PAYLOAD_WRITES: 5,
}

export const DELAYS = {
  CROSSREF_MS: 350,
  UNPAYWALL_MS: 200,
  DOWNLOAD_MS: 100,
  DETAIL_PAGE_MS: 0,
  METADATA_MS: 300,
  OPENALEX_MS: 110,
}
