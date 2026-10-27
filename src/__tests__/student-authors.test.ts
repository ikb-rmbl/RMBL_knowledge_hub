import { describe, expect, it } from 'vitest'
import { displayProgram, matchStudentRow, type StudentRow } from '../collections/shared/studentAuthors'

const row = (id: number, author_name: string, student_program = 'student_paper'): StudentRow =>
  ({ id, author_name, author_id: id, student_program, curated: false })

describe('matchStudentRow', () => {
  const rows = [row(1, 'Daniel T. Blumstein', 'reu'), row(2, 'Jane Smith'), row(3, 'John Smith', 'thesis')]

  it('matches on family name + first initial against the registry display name', () => {
    expect(matchStudentRow({ given: 'Daniel', family: 'Blumstein' }, rows)?.id).toBe(1)
    expect(matchStudentRow({ given: 'D. T.', family: 'Blumstein' }, rows)?.id).toBe(1)
  })
  it('separates same-surname authors by initial, then by full name', () => {
    expect(matchStudentRow({ given: 'Jane', family: 'Smith' }, rows)?.id).toBe(2)
    expect(matchStudentRow({ given: 'John', family: 'Smith' }, rows)?.id).toBe(3)
  })
  it('is accent- and case-insensitive', () => {
    expect(matchStudentRow({ given: 'kristjan', family: 'Niitepõld' }, [row(9, 'Kristjan Niitepold')])?.id).toBe(9)
  })
  it('returns null when nobody matches', () => {
    expect(matchStudentRow({ given: 'Alice', family: 'Jones' }, rows)).toBeNull()
  })
})

describe('displayProgram', () => {
  it('shows structural seeds as a non-REU student and keeps REU / negative / empty', () => {
    expect(displayProgram('student_paper')).toBe('student')
    expect(displayProgram('thesis')).toBe('student')
    expect(displayProgram('student')).toBe('student')
    expect(displayProgram('reu')).toBe('reu')
    expect(displayProgram('none')).toBe('none')
    expect(displayProgram(null)).toBeNull()
  })
})
