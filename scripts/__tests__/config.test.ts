import { describe, it, expect } from 'vitest'

// Test the .env parsing logic from config.ts
// We replicate the parser here since it's inline

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx < 0) return null
  const key = trimmed.slice(0, eqIdx).trim()
  const value = trimmed.slice(eqIdx + 1).trim()
  return { key, value }
}

describe('.env line parsing', () => {
  it('parses simple key=value', () => {
    expect(parseEnvLine('DATABASE_URL=postgresql://localhost:5432/test')).toEqual({
      key: 'DATABASE_URL',
      value: 'postgresql://localhost:5432/test',
    })
  })

  it('skips comments', () => {
    expect(parseEnvLine('# This is a comment')).toBeNull()
  })

  it('skips empty lines', () => {
    expect(parseEnvLine('')).toBeNull()
    expect(parseEnvLine('   ')).toBeNull()
  })

  it('handles values with = signs', () => {
    const result = parseEnvLine('NEON_URL=postgresql://user:pass@host/db?sslmode=require')
    expect(result?.key).toBe('NEON_URL')
    expect(result?.value).toContain('sslmode=require')
  })

  it('handles values with special characters', () => {
    const result = parseEnvLine('API_KEY=sk-ant-api03-abc123&def456')
    expect(result?.key).toBe('API_KEY')
    expect(result?.value).toBe('sk-ant-api03-abc123&def456')
  })

  it('skips lines without =', () => {
    expect(parseEnvLine('JUST_A_KEY')).toBeNull()
  })

  it('trims whitespace around key and value', () => {
    expect(parseEnvLine('  KEY  =  value  ')).toEqual({ key: 'KEY', value: 'value' })
  })
})
