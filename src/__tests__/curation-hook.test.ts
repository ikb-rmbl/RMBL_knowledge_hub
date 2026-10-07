import { describe, expect, it } from 'vitest'
import { curationHookFor, isPipelineWrite } from '../collections/shared/curationHook'

describe('isPipelineWrite', () => {
  it('reads the REST query flag (Payload does not copy it into req.context)', () => {
    expect(isPipelineWrite({ context: {}, query: { context: { pipeline: 'true' } } })).toBe(true)
    expect(isPipelineWrite({ context: {}, searchParams: new URLSearchParams('context[pipeline]=true') })).toBe(true)
  })
  it('accepts Local API context', () => {
    expect(isPipelineWrite({ context: { pipeline: true } })).toBe(true)
  })
  it('is false for ordinary admin edits', () => {
    expect(isPipelineWrite({ context: {}, query: {} })).toBe(false)
    expect(isPipelineWrite(undefined)).toBe(false)
  })
})

describe('curationHookFor', () => {
  const hook = curationHookFor(['publications'])
  const originalDoc = { publications: [1, 2, 3], curatedFields: [] }
  it('does not mark fields changed by a pipeline REST write', () => {
    const data = hook({ data: { publications: [1, 2] }, originalDoc, operation: 'update', req: { context: {}, query: { context: { pipeline: 'true' } } } } as any)
    expect((data as any).curatedFields ?? []).toEqual([])
  })
  it('marks fields changed by an admin edit', () => {
    const data = hook({ data: { publications: [1, 2] }, originalDoc, operation: 'update', req: { context: {}, query: {} } } as any)
    expect((data as any).curatedFields).toContain('publications')
  })
})
