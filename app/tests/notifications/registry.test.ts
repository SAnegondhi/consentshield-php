// ADR-1005 Sprint 6.1 — adapter registry unit tests.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAdapter,
  registerAdapter,
  registeredTypes,
  resetRegistry,
  unregisterAdapter,
} from '../../src/lib/notifications/adapters/registry'
import { createMockAdapter } from '../../src/lib/notifications/adapters/mock'
import { UnknownAdapterError } from '../../src/lib/notifications/adapters/types'

beforeEach(() => resetRegistry())

describe('registry', () => {
  it('returns the registered adapter by channel type', () => {
    const mock = createMockAdapter()
    registerAdapter(mock)
    expect(getAdapter('mock')).toBe(mock)
  })

  it('throws UnknownAdapterError for unregistered types', () => {
    expect(() => getAdapter('slack')).toThrow(UnknownAdapterError)
    expect(() => getAdapter('slack')).toThrow(/channel_type=slack/)
  })

  it('lists registered types', () => {
    registerAdapter(createMockAdapter())
    expect(registeredTypes()).toEqual(['mock'])
  })

  it('unregister removes the adapter', () => {
    registerAdapter(createMockAdapter())
    unregisterAdapter('mock')
    expect(() => getAdapter('mock')).toThrow(UnknownAdapterError)
  })

  it('re-registering replaces the prior instance', () => {
    const first = createMockAdapter()
    const second = createMockAdapter()
    registerAdapter(first)
    registerAdapter(second)
    expect(getAdapter('mock')).toBe(second)
    expect(getAdapter('mock')).not.toBe(first)
  })
})
