// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { testMission } from '../testMission'
import { DecisionTrace } from './DecisionTrace'
import { EvidenceRoom } from './EvidenceRoom'

afterEach(cleanup)

describe('Evidence surfaces', () => {
  it('exposes exact boundaries, replay download, checks, and immutable artifacts', () => {
    render(<EvidenceRoom mission={testMission()} />)
    expect(screen.getByRole('heading', { name: 'Download the proof, not just the pitch' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Replay ZIP/ }).getAttribute('href')).toBe('/api/v1/missions/mission-1/bundle')
    expect(screen.getByText('EVERY RULE PASSED')).toBeTruthy()
    expect(screen.getByText('Every required task is scheduled')).toBeTruthy()
    expect(screen.getByText('2 checksummed files')).toBeTruthy()
    expect(screen.getByText('AI-REVIEW-PROMPT.md')).toBeTruthy()
    expect(screen.getByText(/Five ways of saying the same request/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /How Cortex works/ }).getAttribute('href')).toBe('https://docs.hexstellar.com/')
    expect(screen.getByRole('link', { name: /Public CLI\/client/ }).getAttribute('href')).toBe('https://github.com/brayonpi/hexstellar')
  })

  it('filters observable events without exposing hidden reasoning', () => {
    render(<DecisionTrace mission={testMission()} busy={false} />)
    expect(screen.getByText('Mission intent compiled')).toBeTruthy()
    expect(screen.getByText('Replay passed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Checker' }))
    expect(screen.queryByText('Mission intent compiled')).toBeNull()
    expect(screen.getByText('Replay passed')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download full event log' }).getAttribute('href')).toBe('/api/v1/missions/mission-1/logs')
  })
})
