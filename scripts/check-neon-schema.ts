/**
 * Diagnostic: list the neighborhood tables on Neon and their columns (after a SQL
 * migration). Read-only. Usage: npx tsx scripts/check-neon-schema.ts
 */
import pg from 'pg'
import './lib/config.js'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.NEON_DIRECT_URL, ssl: { rejectUnauthorized: false } })
  const { rows } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'neighborhood%'
    ORDER BY table_name
  `)
  console.log('Neighborhood tables on Neon:', rows.map(r => r.table_name))

  for (const r of rows) {
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position
    `, [r.table_name])
    console.log(`\n${r.table_name} columns:`, cols.map(c => c.column_name).join(', '))
  }
  await pool.end()
}
main()
