import { describe, expect, it, vi } from 'vitest'

import { createMemoryOrderStore } from './order-store'

vi.mock('../orders', () => { throw new Error('Read-only offline storage must not initialize form validation') })

describe('read-only listing dependency boundary', () => {
  it('opens the order store without loading validation schemas', async () => {
    expect(await createMemoryOrderStore().listPending()).toEqual([])
  })
})
