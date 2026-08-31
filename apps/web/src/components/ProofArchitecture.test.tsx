// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProofArchitecture } from './ProofArchitecture'

afterEach(cleanup)

describe('ProofArchitecture', () => {
  it('explains every responsibility in plain language', () => {
    render(<ProofArchitecture languageModelName="Gemini 3.5 Flash" executionMode="live" candidateSpace={262144} candidateCount={18} passedRuleGroups={8} />)
    expect(screen.getByRole('heading', { name: /translator, a planner, an inspector/ })).toBeTruthy()
    expect(screen.getByText('Gemini 3.5 Flash is the translator')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What “every rule passed” means in ordinary language.' })).toBeTruthy()
    expect(screen.getByText('262,144 possible subsets from 18 candidate pieces, before constraints')).toBeTruthy()
    expect(screen.getByText('Live Cortex execution recorded')).toBeTruthy()
  })

  it('states the semantic and physical limits without hiding them', () => {
    render(<ProofArchitecture languageModelName="Gemini 3.5 Flash" />)
    expect(screen.getByText(/checker cannot read the operator’s mind/)).toBeTruthy()
    expect(screen.getByText(/does not claim real spacecraft safety/)).toBeTruthy()
    expect(screen.getByText(/does not claim those services are deterministic/)).toBeTruthy()
    expect(screen.getByText('Transparent non-live execution')).toBeTruthy()
    expect(screen.getByText(/not a third-party certification/)).toBeTruthy()
  })
})
