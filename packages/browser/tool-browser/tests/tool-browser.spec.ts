import { describe, expect, it } from 'vitest'
import { capText, interactiveLines } from '@pentest-harness/dsh-tool-browser'

describe('interactiveLines', () => {
  it('keeps only interactive roles that carry a ref', () => {
    const snapshot = [
      '- generic [ref=e1]:',
      '  - heading "Title" [level=1] [ref=e2]',
      '  - link "Home" [ref=e3]:',
      '  - textbox "Search" [ref=e4]',
      '  - button "Go" [ref=e5]',
      '  - paragraph: text',
    ].join('\n')
    expect(interactiveLines(snapshot)).toBe('- link "Home" [ref=e3]:\n- textbox "Search" [ref=e4]\n- button "Go" [ref=e5]')
  })
})

describe('capText', () => {
  it('passes short text and marks truncation at the exact limit', () => {
    expect(capText('abc', 3)).toBe('abc')
    const capped = capText('abcdef', 4)
    expect(capped.startsWith('abcd\n\n[Truncated: showing 4 of 6 characters.')).toBe(true)
  })
})
