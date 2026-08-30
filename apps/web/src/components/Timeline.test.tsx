// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { testMission } from '../testMission'
import { Timeline } from './Timeline'

afterEach(cleanup)

describe('Timeline', () => {
  it('derives recovered rows, resource metrics, and inspectable action evidence', () => {
    render(<Timeline mission={testMission()} view="recovered" />)
    expect(screen.getByRole('heading', { name: 'recovered schedule' })).toBeTruthy()
    expect(screen.getByText('96')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'downlink on SAT-01, minute 12 to 20' }))
    expect(screen.getByText('REC-01')).toBeTruthy()
    expect(screen.getByText('12–20 min')).toBeTruthy()
    expect(screen.getAllByText('GS-01')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('REC-01')).toBeNull()
  })

  it('shows both nominal and recovered provenance in diff mode', () => {
    render(<Timeline mission={testMission()} view="diff" />)
    expect(screen.getByRole('heading', { name: 'Nominal ↔ recovered schedule' })).toBeTruthy()
    expect(screen.getByText('nominal')).toBeTruthy()
    expect(screen.getByText('recovered')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'compute on SAT-01, minute 5 to 10' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'downlink on GS-01, minute 12 to 20' })).toBeTruthy()
  })
})
