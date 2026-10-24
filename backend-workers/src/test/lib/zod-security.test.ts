import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('Zod collection resource limits', () => {
  it('rejects an oversized constrained array before validating each element', () => {
    let visited = 0
    const schema = z.array(z.string().refine(() => {
      visited += 1
      return false
    })).max(2)

    const result = schema.safeParse(Array.from({ length: 1_000 }, () => '[E2E_TEST] invalid'))

    expect(result.success).toBe(false)
    expect(visited).toBe(0)
    if (!result.success) expect(result.error.issues).toHaveLength(1)
  })

  it('still validates elements when the array is within its limit', () => {
    const schema = z.array(z.string().min(1)).max(2)

    expect(schema.safeParse(['[E2E_TEST] valid']).success).toBe(true)
    expect(schema.safeParse(['']).success).toBe(false)
  })
})
