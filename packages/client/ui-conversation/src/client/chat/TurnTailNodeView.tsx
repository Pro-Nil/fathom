import { memo } from 'react'
import type { PropsRenderSlots } from '@pentest-harness/dsh-client-ui-slots'
import { Button } from '@pentest-harness/dsh-client-ui-primitives'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/** Turn-end reasons after which the agent stopped before finishing its work, with their hint text. */
const RESUMABLE_END_REASONS = {
  'error': 'turn.resume.reason.error',
  'aborted': 'turn.resume.reason.aborted',
  'max-tokens': 'turn.resume.reason.max-tokens',
  'interrupted': 'turn.resume.reason.interrupted',
} as const

function resumeHintKey(reason: string): typeof RESUMABLE_END_REASONS[keyof typeof RESUMABLE_END_REASONS] | undefined {
  return Object.hasOwn(RESUMABLE_END_REASONS, reason)
    ? RESUMABLE_END_REASONS[reason as keyof typeof RESUMABLE_END_REASONS]
    : undefined
}

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, resume, renderSlot, renderSlotChain, t, useSession,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useSession(snapshot =>
    snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key)
  const isLatestTurn = useSession(snapshot => snapshot.chat.timeline.turnOrder.at(-1) === data.turn)
  const running = useSession(snapshot => snapshot.running) ?? false
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const hintKey = resumeHintKey(data.endReason)
  const resumeButton = isLatestTurn && !running && hintKey !== undefined
    ? (
      <div className={css.resume} data-turn-resume={data.turn}>
        <Button variant="primary" onClick={() => { resume(data.endReason) }}>{t('turn.resume')}</Button>
        <span className={css.resumeHint}>{t(hintKey)}</span>
      </div>
    )
    : null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  if (closing === null) {
    return tail === null && resumeButton === null
      ? null
      : <div className={css.root}>{tail}{resumeButton}</div>
  }
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  return (
    <div className={css.root} data-turn-tail={data.turn} data-time-hover-root>
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        runMs={runMs}
        ttftMs={data.ttftMs}
        tokensPerSecond={data.tokensPerSecond}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        branchUnavailable={data.branchUnavailable || hasLaterChatNode}
        className={css.actions}
        extraActions={assistantActions}
        t={t}
      />
      {resumeButton}
    </div>
  )
})
