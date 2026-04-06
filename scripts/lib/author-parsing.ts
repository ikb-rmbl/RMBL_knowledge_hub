/**
 * Author string parsing utilities.
 *
 * Parses author strings in "LastName Initials" format (comma-separated)
 * into structured {given, family} objects. Handles edge cases like:
 * - Multi-word surnames (de Boer, Van Vuren)
 * - Student markers (asterisks)
 * - "et al" suffixes
 * - Editor strings in various formats
 */

export interface ParsedAuthor {
  given: string
  family: string
}

/**
 * Parse a comma-separated author string like "Smith JA, de Boer G, Jones K*"
 */
export function parseAuthors(authorStr: string): ParsedAuthor[] {
  if (!authorStr) return []

  let cleaned = authorStr.replace(/,?\s*et al\.?\s*$/i, '').trim()
  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.map(parseOneAuthor)
}

/**
 * Parse a single author entry like "Smith JA" or "de Boer G"
 */
export function parseOneAuthor(raw: string): ParsedAuthor {
  const cleaned = raw.replace(/\*/g, '').trim()
  const tokens = cleaned.split(/\s+/)

  if (tokens.length === 1) {
    return { given: '', family: tokens[0] }
  }

  const lastToken = tokens[tokens.length - 1]
  const isInitials = /^[A-Z]{1,5}$/.test(lastToken)

  if (isInitials) {
    const family = tokens.slice(0, -1).join(' ')
    const given = lastToken.split('').join('. ') + '.'
    return { given, family }
  }

  return {
    given: tokens[0],
    family: tokens.slice(1).join(' '),
  }
}

/**
 * Parse a creator name in "LastName, FirstName" or "FirstName LastName" format.
 * Used for dataset creator names and similar mixed-format inputs.
 */
export function parseCreatorName(name: string): ParsedAuthor {
  const cleaned = name.trim()
  if (!cleaned) return { given: '', family: '' }

  // "LastName, FirstName" or "LastName, I.N."
  if (cleaned.includes(',')) {
    const [family, ...rest] = cleaned.split(',')
    return { family: family.trim(), given: rest.join(',').trim() }
  }

  // "FirstName LastName" or "F. LastName" or "FirstName MiddleName LastName"
  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return { given: '', family: parts[0] }

  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] }
}

/**
 * Expand compact initials into dotted form.
 * "JA" -> "J. A.", "J" -> "J.", already-dotted stays as-is.
 */
export function expandInitials(given: string): string {
  if (!given) return ''
  if (given.includes('.')) return given
  if (given.length === 1) return given + '.'
  if (/^[A-Z]{2,5}$/.test(given)) {
    return given.split('').join('. ') + '.'
  }
  return given
}

/**
 * Build a display name from given + family, expanding initials.
 */
export function buildDisplayName(given: string, family: string): string {
  if (!given) return family
  return `${expandInitials(given)} ${family}`.trim()
}

/**
 * Parse editor strings which may be in "J. E. Moran" or "Moran JE" format
 */
export function parseEditors(editorStr: string | null): ParsedAuthor[] {
  if (!editorStr) return []
  const parts = editorStr.split(/,\s*(?:and\s+)?|;\s*|\s+and\s+/).filter(Boolean)
  return parts.map((p) => {
    const tokens = p.trim().split(/\s+/)
    if (tokens.length === 1) return { given: '', family: tokens[0] }
    if (/^[A-Z]\.?$/.test(tokens[0]) || /^[A-Z]\.\s*[A-Z]\.?$/.test(tokens.slice(0, 2).join(' '))) {
      const initialsEnd = tokens.findIndex((t, i) => i > 0 && !/^[A-Z]\.?$/.test(t))
      if (initialsEnd > 0) {
        return {
          given: tokens.slice(0, initialsEnd).join(' '),
          family: tokens.slice(initialsEnd).join(' '),
        }
      }
    }
    return parseOneAuthor(p.trim())
  })
}
