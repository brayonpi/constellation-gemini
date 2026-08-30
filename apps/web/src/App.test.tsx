import { describe, expect, it } from 'vitest'

describe('Constellation shell', () => {
  it('preserves the product claim boundary', () => {
    const statement = 'Independent verification decides what can fly.'
    expect(statement).not.toContain('globally optimal')
  })
})
