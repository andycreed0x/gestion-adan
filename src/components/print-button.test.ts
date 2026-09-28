/* @vitest-environment jsdom */

import { createElement, StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PrintButton } from './print-button'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PrintButton', () => {
  it('opens the native print dialog automatically when requested', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)

    render(createElement(StrictMode, null, createElement(PrintButton, { autoPrint: true })))

    expect(print).toHaveBeenCalledTimes(1)
  })
})
