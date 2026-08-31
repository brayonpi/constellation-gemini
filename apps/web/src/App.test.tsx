import { describe, expect, it } from 'vitest'
import { EXTERNAL_LINKS } from './links'

describe('Constellation shell', () => {
  it('preserves the product claim boundary', () => {
    const statement = 'A separate checker decides whether this simulated plan may update the sandbox.'
    expect(statement).not.toContain('globally optimal')
    expect(statement).not.toContain('real spacecraft')
  })

  it('sends judges only to the intended public HexStellar surfaces', () => {
    expect(EXTERNAL_LINKS.cortexDocs).toBe('https://docs.hexstellar.com/')
    expect(EXTERNAL_LINKS.cortexExamples).toBe('https://docs.hexstellar.com/examples/')
    expect(EXTERNAL_LINKS.cortexClient).toBe('https://github.com/brayonpi/hexstellar')
    expect(EXTERNAL_LINKS.projectSource).toBe('https://github.com/brayonpi/constellation-gemini')
    expect(EXTERNAL_LINKS.verifierSource).toBe('https://github.com/brayonpi/constellation-gemini/blob/main/apps/api/constellation/verifier.py')
    expect(EXTERNAL_LINKS.founderLinkedIn).toBe('https://www.linkedin.com/in/brayonpieske/')
    expect(EXTERNAL_LINKS.hexstellar).toBe('https://hexstellar.com/')
    expect(EXTERNAL_LINKS.trustCarbon).toBe('https://trustcarbon.org/')
  })
})
