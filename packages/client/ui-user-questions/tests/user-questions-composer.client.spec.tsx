// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  ConversationSnapshot, SessionId, SessionListState, WorkspaceListState,
} from '@pentest-harness/dsh-client-runtime/client'
import { PendingWait } from '@pentest-harness/dsh-client-runtime/client'
import type { RpcReceipt } from '@pentest-harness/dsh-api-remotes/client'
import { RpcId } from '@pentest-harness/dsh-client-connection/client'
import type { SnapshotSelectorHook } from '@pentest-harness/dsh-client-ui-slots'
import { PendingQuestion, type QuestionComposerProps } from '../src/client/contract/slots.ts'
import { QuestionComposer, parseRecommendedLabel } from '../src/client/QuestionComposer.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@pentest-harness/dsh-client-locale/src/locales/en.ts'

afterEach(cleanup)

const SID = 's1' as SessionId

/** Seat stub over a dictionary pair mirroring the real lookup chain: package dictionary, then common vocabulary, then the key. */
const seatOver = (dict: Record<string, string>, common: Record<string, string>): QuestionComposerProps['t'] =>
  (key => dict[key] ?? common[key] ?? key)

/** Framework standard-kit stubs: the composer consumes only the locale seat;
 *  the composed props type mandates delivery of the rest (framework hooks are
 *  plain stubs per the client testing discipline). */
const kit = {
  session: undefined,
  sessionId: SID,
  useSession: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<ConversationSnapshot>,
  useSessions: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<SessionListState>,
  useWorkspaces: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<WorkspaceListState>,
  useProjection: (() => undefined) as never,
  useInput: (() => { throw new Error('unused') }) as never,
  inputActions: { setDraft: () => { throw new Error('unused') }, submit: () => { throw new Error('unused') } } as never,
  // The seat's key domain is question ∪ common.
  t: seatOver(en, commonEn),
}

const QUESTIONS = [
  {
    id: 'profile', header: '첑섻', question: '쌇뎗쁿쌇쥒뉥셱',
    detail: '텟삙뛋슦뾮룕퇯춘뤨뚤뜑쌇뎗。',
    options: [
      { label: '귓킡툧휠셱 (Recommended)', description: '뤨뚤귓킡꽤퓠。' },
      { label: '뤘짖듈썡셱', description: '뤨뚤뤘짖놻썡。' },
    ],
  },
  {
    id: 'detail', question: '껓넟몴춘밳봮',
  },
  {
    id: 'signals', question: '쌇뎗퐃밳췗딉（썩릦쌇）', multiSelect: true,
    options: [{ label: '툽핝쌎홯' }, { label: '찅큓녠몙' }, { label: '듩봃되곻' }],
  },
]

/** Carrier fixture: a real PendingWait over a scripted respond carrier. */
function wait(rpcId = 'question-1', respond = vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: true }))) {
  const carrier = new PendingWait(
    'question', RpcId(rpcId), SID, { questions: QUESTIONS }, respond)
  return { carrier, respond }
}

/** The client-response envelope respond must have received for an answer batch. */
function answeredEnvelope(rpcId: string, answers: object[]) {
  return {
    type: 'client-response', rpcId: RpcId(rpcId),
    result: { ok: true, value: { sessionId: SID, answer: { answers } } },
  }
}

describe('QuestionComposer', () => {
  it('collects single, custom, and multi-select answers before one batch submit', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    expect(screen.getByText('첑섻')).toBeTruthy()
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.getByText('귓킡툧휠셱')).toBeTruthy()
    const detail = screen.getByText('텟삙뛋슦뾮룕퇯춘뤨뚤뜑쌇뎗。')
    const scrollRegion = detail.closest('[data-question-scroll]')
    expect(scrollRegion).toBeTruthy()
    expect(scrollRegion?.contains(screen.getByRole('radio', { name: /귓킡툧휠셱/ }))).toBe(true)
    expect(scrollRegion?.contains(screen.getByText('Next').closest('button'))).toBe(false)
    fireEvent.keyDown(screen.getByRole('radio', { name: /귓킡툧휠셱/ }), { key: 'Enter' })
    expect(respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: /귓킡툧휠셱/ }))

    expect(screen.getByText('2 / 3')).toBeTruthy()
    // detail is per-question: the second question carries none.
    expect(screen.queryByText('텟삙뛋슦뾮룕퇯춘뤨뚤뜑쌇뎗。')).toBeNull()
    expect(screen.queryByRole('button', { name: '략좿균콐' })).toBeNull()
    const custom = screen.getByPlaceholderText('Type your answer')
    fireEvent.change(custom, { target: { value: '밳놻졠퓁혢잻랕퐖뉚쒤' } })
    fireEvent.keyDown(custom, { key: 'Enter' })

    expect(screen.getByText('3 / 3')).toBeTruthy()
    // The model's question text renders verbatim — no marker filtering.
    expect(screen.getByText('쌇뎗퐃밳췗딉（썩릦쌇）')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '툽핝쌎홯' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '툽핝쌎홯' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '툽핝쌎홯' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '찅큓녠몙' }))
    const multiCustom = screen.getByPlaceholderText('Type your answer')
    fireEvent.change(multiCustom, { target: { value: '릹씶놻썡' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '듩봃되곻' }))
    expect(screen.getByRole('checkbox', { name: '툽핝쌎홯' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: '찅큓녠몙' }).getAttribute('aria-checked')).toBe('true')
    expect((multiCustom as HTMLInputElement).value).toBe('릹씶놻썡')
    fireEvent.keyDown(multiCustom, { key: 'Enter' })

    // The domain face encoded the whole batch into one carrier envelope.
    expect(respond).toHaveBeenCalledWith(answeredEnvelope('question-1', [
      { id: 'profile', selected: ['귓킡툧휠셱 (Recommended)'] },
      { id: 'detail', selected: [], custom: '밳놻졠퓁혢잻랕퐖뉚쒤' },
      { id: 'signals', selected: ['툽핝쌎홯', '찅큓녠몙', '듩봃되곻'], custom: '릹씶놻썡' },
    ]))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Submitting…' }).disabled).toBe(true)
  })

  it('renders plan detail through the shared assistant Markdown primitive', () => {
    const carrier = new PendingWait(
      'question',
      RpcId('markdown-plan'),
      SID,
      {
        questions: [{
          id: 'plan',
          question: '칇쑂쇿옺홯뺞틑？',
          detail: '# 컂믟홯뺞\n\n- **뚤효좓**앐뱎\n- 휶컛 `QuestionComposer`',
          options: [{ label: '칇쑂' }],
        }],
      },
      vi.fn(),
    )
    const view = render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    expect(screen.getByRole('heading', { level: 1, name: '컂믟홯뺞' })).toBeTruthy()
    expect(view.container.querySelector('strong')?.textContent).toBe('뚤효좓')
    expect(view.container.querySelector('code')?.textContent).toBe('QuestionComposer')
    expect(view.container.querySelectorAll('li')).toHaveLength(2)
  })

  it('skips individual questions without discarding earlier answers', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    expect((screen.getByText('Next').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '뤘짖듈썡셱' }))
    expect(screen.getByText('2 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skip this question' }))
    expect(screen.getByText('3 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skip this question' }))

    expect(respond).toHaveBeenCalledWith(answeredEnvelope('question-1', [
      { id: 'profile', selected: ['뤘짖듈썡셱'] },
      { id: 'detail', selected: [] },
      { id: 'signals', selected: [] },
    ]))
  })

  it('keeps IME Enter inside the custom input until composition finishes', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    fireEvent.click(screen.getByRole('radio', { name: '뤘짖듈썡셱' }))
    const custom = screen.getByPlaceholderText('Type your answer')
    fireEvent.change(custom, { target: { value: '쮿꿍튭컧' } })

    fireEvent.keyDown(custom, { key: 'Enter', isComposing: true })
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(respond).not.toHaveBeenCalled()

    fireEvent.keyDown(custom, { key: 'Enter', keyCode: 229 })
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(respond).not.toHaveBeenCalled()

    fireEvent.keyDown(custom, { key: 'Enter' })
    expect(screen.getByText('3 / 3')).toBeTruthy()
  })

  it('shows the inline custom input, reports missing answers, and supports pager navigation', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    expect(screen.getByPlaceholderText('Type your answer')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '귓킡툧휠셱' }))
    const emptyCustom = screen.getByPlaceholderText('Type your answer')
    fireEvent.keyDown(emptyCustom, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('2 / 3')).toBeTruthy()
    fireEvent.keyDown(emptyCustom, { key: 'Enter' })
    expect(screen.getByText('Please select an option or enter a custom answer.')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Next question'))
    fireEvent.click(screen.getByRole('checkbox', { name: '듩봃되곻' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(screen.getByText('Please complete this question first.')).toBeTruthy()
    expect(screen.getByText('2 / 3')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Previous question'))
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(respond).not.toHaveBeenCalled()
  })

  it('answers over multiple lines: both fields grow with the draft and keep Shift+Enter a newline', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    // Both question shapes answer into a textarea, so the engine soft-wraps a
    // long answer and Shift+Enter breaks the line natively.
    const inline = screen.getByPlaceholderText('Type your answer')
    expect(inline.tagName).toBe('TEXTAREA')

    const multiline = '쨜퀼묄\n쨜껠묄'
    fireEvent.change(inline, { target: { value: multiline } })
    // The hidden height ruler carries the draft plus the trailing newline the
    // textarea's own last line needs, so the box is as tall as the answer.
    expect(inline.previousElementSibling?.textContent).toBe(`${multiline}\n`)
    // Shift+Enter belongs to the field, never to the flow.
    fireEvent.keyDown(inline, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('1 / 3')).toBeTruthy()

    fireEvent.keyDown(inline, { key: 'Enter' })
    const optionless = screen.getByPlaceholderText('Type your answer')
    expect(optionless.tagName).toBe('TEXTAREA')
    fireEvent.change(optionless, { target: { value: multiline } })
    expect(optionless.previousElementSibling?.textContent).toBe(`${multiline}\n`)
    fireEvent.keyDown(optionless, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('2 / 3')).toBeTruthy()

    fireEvent.keyDown(optionless, { key: 'Enter' })
    fireEvent.click(screen.getByRole('checkbox', { name: '툽핝쌎홯' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    // Line breaks reach the model verbatim: nothing along the way flattens them.
    expect(respond).toHaveBeenCalledWith(answeredEnvelope('question-1', [
      { id: 'profile', selected: [], custom: multiline },
      { id: 'detail', selected: [], custom: multiline },
      { id: 'signals', selected: ['툽핝쌎홯'] },
    ]))
  })

  it('surfaces cancellation failures: rejected receipt text and raw transport reasons', async () => {
    const respond = vi.fn()
      .mockResolvedValueOnce({ accepted: false, reason: 'bad-response' })
      .mockRejectedValueOnce(new Error('쨜껠쎳쾚삌웟흿'))
    const { carrier } = wait('question-1', respond)
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)

    // Receipt rejection surfaces through the domain face's thrown message.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all questions' }))
    expect(await screen.findByText('question cancellation rejected: bad-response')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Skip this question' }).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all questions' }))
    expect(await screen.findByText('쨜껠쎳쾚삌웟흿')).toBeTruthy()
  })

  it('surfaces transport rejection and resets local drafts for a different request', async () => {
    const respond = vi.fn()
      .mockRejectedValueOnce(new Error('쳧쿘쮿곻'))
      .mockRejectedValueOnce('삁뼒럚댻띡')
    const first = wait('first', respond)
    const view = render(<QuestionComposer matched={first.carrier} interactions={[first.carrier]} {...kit} />)

    fireEvent.click(screen.getByRole('radio', { name: /뤘짖듈썡셱/ }))
    expect(screen.getByText('2 / 3')).toBeTruthy()
    const second = wait('second', respond)
    view.rerender(<QuestionComposer matched={second.carrier} interactions={[second.carrier]} {...kit} />)
    expect(screen.getByRole('radio', { name: /뤘짖듈썡셱/ }).getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByRole('radio', { name: /귓킡툧휠셱/ }))
    const custom = screen.getByPlaceholderText('Type your answer')
    fireEvent.change(custom, { target: { value: 'x' } })
    fireEvent.keyDown(custom, { key: 'Enter' })
    fireEvent.click(screen.getByRole('checkbox', { name: '툽핝쌎홯' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(respond).toHaveBeenNthCalledWith(1, answeredEnvelope('second', [
      { id: 'profile', selected: ['귓킡툧휠셱 (Recommended)'] },
      { id: 'detail', selected: [], custom: 'x' },
      { id: 'signals', selected: ['툽핝쌎홯'] },
    ]))
    expect(await screen.findByText('쳧쿘쮿곻')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Submit' }).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('삁뼒럚댻띡')).toBeTruthy()
  })

  it('renders chrome copy through the English dictionary', () => {
    const respond = vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: true }))
    const carrier = new PendingWait(
      'question', RpcId('solo'), SID, { questions: [{ id: 'detail', question: '껓넟몴춘밳봮' }] }, respond)
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} t={seatOver(en, commonEn)} />)
    expect(screen.getByLabelText('Dismiss all questions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Skip this question' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Type your answer')).toBeTruthy()
  })

  it('same-key carrier replacement (baseline replay) keeps drafts', () => {
    const first = wait('same-id')
    const view = render(<QuestionComposer matched={first.carrier} interactions={[first.carrier]} {...kit} />)
    fireEvent.click(screen.getByRole('radio', { name: /뤘짖듈썡셱/ }))
    expect(screen.getByText('2 / 3')).toBeTruthy()
    // Replay mints a NEW carrier for the same request; same key = no remount.
    const replayed = wait('same-id')
    view.rerender(<QuestionComposer matched={replayed.carrier} interactions={[replayed.carrier]} {...kit} />)
    expect(screen.getByText('2 / 3')).toBeTruthy()
  })
})

describe('PendingQuestion domain face', () => {
  it('encodes the answer batch into the ok envelope and throws on a rejected receipt', async () => {
    const respond = vi.fn()
      .mockResolvedValueOnce({ accepted: true })
      .mockResolvedValueOnce({ accepted: false, reason: 'not-pending' })
    const question = new PendingQuestion(wait('rq', respond).carrier)
    const batch = { answers: [{ id: 'mode', selected: ['Fast'] }] }
    await expect(question.answer(batch)).resolves.toBeUndefined()
    expect(respond).toHaveBeenCalledWith(answeredEnvelope('rq', batch.answers))
    await expect(question.answer(batch)).rejects.toThrow(/question response rejected: not-pending/)
  })

  it('encodes cancellation as the cancelled error envelope and throws on a rejected receipt', async () => {
    const respond = vi.fn()
      .mockResolvedValueOnce({ accepted: true })
      .mockResolvedValueOnce({ accepted: false, reason: 'bad-response' })
    const question = new PendingQuestion(wait('rc', respond).carrier)
    await expect(question.cancel()).resolves.toBeUndefined()
    expect(respond).toHaveBeenCalledWith({
      type: 'client-response', rpcId: RpcId('rc'),
      result: {
        ok: false,
        error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
      },
    })
    await expect(question.cancel()).rejects.toThrow(/question cancellation rejected: bad-response/)
  })

  it('forwards key and questions from the carrier', () => {
    const question = new PendingQuestion(wait('rk').carrier)
    expect(question.key).toBe('q:rk')
    expect(question.questions).toBe(wait('rk').carrier.payload.questions)
  })

  it('collapses the card to the header strip and expands it back', () => {
    const { carrier } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)
    // Expanded: the option list is visible.
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    // Collapse: options leave the tree; the title and minimize toggle stay.
    fireEvent.click(screen.getByLabelText(en['nav.minimize']))
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('쌇뎗쁿쌇쥒뉥셱')).toBeTruthy()
    // Expand: the options return (the toggle label flips while collapsed).
    fireEvent.click(screen.getByLabelText(en['nav.maximize']))
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    // Expanded again: the toggle reports expanded and the option list is back.
    expect(screen.getByLabelText(en['nav.minimize']).getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the collapse toggle out of the cancel path and preserves drafts across collapse', () => {
    const { carrier, respond } = wait()
    render(<QuestionComposer matched={carrier} interactions={[carrier]} {...kit} />)
    fireEvent.click(screen.getByRole('radio', { name: /귓킡툧휠셱/ }))
    // Single-select auto-advances to the second question; collapse and expand
    // must not lose either the picked option or the current position.
    fireEvent.click(screen.getByLabelText(en['nav.minimize']))
    fireEvent.click(screen.getByLabelText(en['nav.maximize']))
    const custom = screen.getByPlaceholderText(en['custom.placeholder'])
    fireEvent.change(custom, { target: { value: '밳놻졠퓁혢잻랕퐖뉚쒤' } })
    // Re-expanding must not steal focus back into the textarea: it was
    // autofocused on first presentation, so focus stays on the expand toggle.
    expect(document.activeElement).not.toBe(custom)
    fireEvent.click(screen.getByLabelText('Next question'))
    fireEvent.click(screen.getByRole('checkbox', { name: '툽핝쌎홯' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(respond).toHaveBeenCalledWith(answeredEnvelope('question-1', [
      { id: 'profile', selected: ['귓킡툧휠셱 (Recommended)'] },
      { id: 'detail', custom: '밳놻졠퓁혢잻랕퐖뉚쒤', selected: [] },
      { id: 'signals', selected: ['툽핝쌎홯'] },
    ]))
  })
})

describe('parseRecommendedLabel', () => {
  it('recognizes the recommended suffix without changing ordinary labels', () => {
    expect(parseRecommendedLabel('Fast (Recommended)')).toEqual({ label: 'Fast', recommended: true })
    expect(parseRecommendedLabel('Fast (recommended)')).toEqual({ label: 'Fast', recommended: true })
    expect(parseRecommendedLabel('Plain')).toEqual({ label: 'Plain', recommended: false })
  })
})
