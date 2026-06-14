/**
 * Minimal markdown-ish prose renderer for Futures scenario sections and
 * story bodies. Handles paragraphs, bold (**), italic (*), inline code (`),
 * Markdown links ([text](url)), bullet lists (- ), and ### subheadings.
 *
 * No HTML output via dangerouslySetInnerHTML; everything is React elements.
 * Block content (lists, paragraphs, headings) is detected line-by-line and
 * grouped; inline formatting is parsed within each block.
 */

import type { ReactNode } from 'react'
import { Fragment } from 'react'

interface InlineToken {
  kind: 'text' | 'strong' | 'em' | 'code' | 'link'
  content: string
  href?: string
}

/**
 * Parse inline formatting (bold, italic, code, links) in a single span of
 * text. Returns an array of tokens preserving order. Greedy-left match per
 * delimiter; nested formatting is not supported (rare in this corpus).
 */
function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let i = 0
  while (i < text.length) {
    // Bold: **...**
    if (text.slice(i, i + 2) === '**') {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        tokens.push({ kind: 'strong', content: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    // Code: `...`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        tokens.push({ kind: 'code', content: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    // Italic: *...* (single asterisk; only if not start of **)
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1) {
        tokens.push({ kind: 'em', content: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    // Link: [text](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1)
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          tokens.push({
            kind: 'link',
            content: text.slice(i + 1, closeBracket),
            href: text.slice(closeBracket + 2, closeParen),
          })
          i = closeParen + 1
          continue
        }
      }
    }
    // Plain text up to the next special char.
    const next = text.slice(i + 1).search(/[*`[]/)
    const advance = next === -1 ? text.length - i : next + 1
    tokens.push({ kind: 'text', content: text.slice(i, i + advance) })
    i += advance
  }
  return tokens
}

function renderInline(text: string): ReactNode[] {
  return parseInline(text).map((tok, idx) => {
    switch (tok.kind) {
      case 'strong':
        return <strong key={idx}>{tok.content}</strong>
      case 'em':
        return <em key={idx}>{tok.content}</em>
      case 'code':
        return <code key={idx}>{tok.content}</code>
      case 'link':
        return (
          <a key={idx} href={tok.href ?? '#'} target="_blank" rel="noopener noreferrer">
            {tok.content}
          </a>
        )
      default:
        return <Fragment key={idx}>{tok.content}</Fragment>
    }
  })
}

/**
 * Render markdown-ish prose as React elements. Block-level handling:
 *
 * - Lines starting with `### ` → h3
 * - Lines starting with `- ` (grouped contiguously) → ul/li
 * - Lines starting with `> ` (grouped contiguously) → blockquote
 * - Blank-line-separated runs of text → paragraphs
 */
export function Prose({ text, className }: { text: string | null; className?: string }) {
  if (!text) return null

  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // h3 heading.
    if (/^### /.test(line)) {
      blocks.push(<h3 key={`h-${i}`}>{renderInline(line.replace(/^### /, ''))}</h3>)
      i++
      continue
    }

    // Bullet list (contiguous - lines).
    if (/^- /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^- /.test(lines[i])) {
        items.push(lines[i].replace(/^- /, ''))
        i++
      }
      blocks.push(
        <ul key={`ul-${i}`}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Blockquote (contiguous > lines).
    if (/^> /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^> /.test(lines[i])) {
        items.push(lines[i].replace(/^> /, ''))
        i++
      }
      blocks.push(
        <blockquote key={`bq-${i}`}>
          <Prose text={items.join('\n')} />
        </blockquote>,
      )
      continue
    }

    // Skip blank lines between blocks.
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph (gather until blank line or block-trigger).
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^### |^- |^> /.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(<p key={`p-${i}`}>{renderInline(para.join(' '))}</p>)
  }

  return <div className={className}>{blocks}</div>
}
