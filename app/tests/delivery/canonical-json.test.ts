// ADR-1019 Sprint 2.1 — canonical JSON serialization tests.

import { describe, expect, it } from 'vitest'
import { canonicalJson } from '@/lib/delivery/canonical-json'

describe('canonicalJson', () => {
  it('sorts top-level keys lexicographically', () => {
    expect(canonicalJson({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}\n')
  })

  it('sorts nested keys recursively', () => {
    expect(
      canonicalJson({
        outer: { z: 1, a: { y: 2, x: 3 } },
        first: true,
      }),
    ).toBe('{"first":true,"outer":{"a":{"x":3,"y":2},"z":1}}\n')
  })

  it('preserves array order', () => {
    expect(canonicalJson({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}\n')
  })

  it('canonicalises objects inside arrays', () => {
    expect(canonicalJson([{ b: 1, a: 2 }, { d: 3, c: 4 }])).toBe(
      '[{"a":2,"b":1},{"c":4,"d":3}]\n',
    )
  })

  it('handles primitives', () => {
    expect(canonicalJson(null)).toBe('null\n')
    expect(canonicalJson(true)).toBe('true\n')
    expect(canonicalJson(false)).toBe('false\n')
    expect(canonicalJson(42)).toBe('42\n')
    expect(canonicalJson('x')).toBe('"x"\n')
  })

  it('escapes strings correctly', () => {
    expect(canonicalJson({ s: 'he said "hi"' })).toBe(
      '{"s":"he said \\"hi\\""}\n',
    )
    expect(canonicalJson({ s: '\n' })).toBe('{"s":"\\n"}\n')
  })

  it('produces the same output for differently-ordered inputs', () => {
    const a = canonicalJson({ foo: 1, bar: 2 })
    const b = canonicalJson({ bar: 2, foo: 1 })
    expect(a).toBe(b)
  })

  it('terminates with a single LF', () => {
    const out = canonicalJson({ a: 1 })
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  it('throws on non-finite numbers', () => {
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(
      /non-finite/,
    )
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/non-finite/)
  })

  it('throws on unsupported types (bigint, symbol, undefined)', () => {
    expect(() => canonicalJson({ n: 1n } as unknown)).toThrow(/unsupported/)
    expect(() => canonicalJson({ s: Symbol('x') } as unknown)).toThrow(
      /unsupported/,
    )
    expect(() => canonicalJson({ u: undefined } as unknown)).toThrow(
      /unsupported/,
    )
  })
})
