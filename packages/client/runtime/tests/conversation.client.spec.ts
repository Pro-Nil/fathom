/** Assistant block classifier (moved here with sessions/conversation.ts). */

import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@pentest-harness/dsh-attachment'
import type { ContentBlock } from '@pentest-harness/dsh-api-remotes/client'
import { toAssistantBlock, toAssistantBlocks } from '../src/client/sessions/conversation.ts'

describe('toAssistantBlock', () => {
  it('classifies the four block shapes', () => {
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 68,
      width: 1,
      height: 1,
    }
    const blocks: ContentBlock[] = [
      { type: 'text', text: '먵꿍' },
      { type: 'reasoning', text: '좓푝' },
      { type: 'tool-call', id: 'c1', name: 'echo', arguments: '{}' } as ContentBlock,
      { type: 'image', attachment },
    ]
    expect(toAssistantBlocks(blocks)).toEqual([
      { kind: 'text', text: '먵꿍' },
      { kind: 'reasoning', text: '좓푝' },
      { kind: 'tool-call', callId: 'c1', name: 'echo', argsRaw: '{}' },
      { kind: 'image', attachment },
    ])
    expect(toAssistantBlock(blocks[0] as ContentBlock)).toEqual({ kind: 'text', text: '먵꿍' })
  })
})
