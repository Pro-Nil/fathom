/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @fathom/client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/**
 * The Fathom mark for the framework-free boot page. Same geometry as
 * FathomLogo in client-ui-primitives, inlined so the boot page loads no React.
 */
const markSvg = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M9.9 3.4a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0Z" fill="#2DD4BF"/>
  <path d="M18.269 6.733A7.100 7.100 0 0 1 5.731 6.733A1.100 1.100 0 0 1 7.674 5.700A4.900 4.900 0 0 0 16.326 5.700A1.100 1.100 0 0 1 18.269 6.733Z" fill="#2DD4BF"/>
  <path d="M17.312 13.825A11.700 11.700 0 0 1 6.688 13.825A1.100 1.100 0 0 1 7.687 11.865A9.500 9.500 0 0 0 16.313 11.865A1.100 1.100 0 0 1 17.312 13.825Z" fill="#2DD4BF" fill-opacity="0.72"/>
  <path d="M15.528 19.314A16.300 16.300 0 0 1 8.472 19.314A1.100 1.100 0 0 1 8.948 17.166A14.100 14.100 0 0 0 15.052 17.166A1.100 1.100 0 0 1 15.528 19.314Z" fill="#2DD4BF" fill-opacity="0.45"/>
</svg>`

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly wordmark: HTMLDivElement
  private readonly logoWrap: HTMLDivElement
  private readonly spinner: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.fathomBoot = ''
    this.card = div(css.card)
    this.wordmark = div(css.wordmark, 'Fathom')
    this.logoWrap = div(css.logo)
    this.logoWrap.innerHTML = markSvg
    this.spinner = div(css.spinner)
    this.spinner.dataset.fathomBootSpinner = ''
    this.hint = div(css.hint, 'Spinning up recon engines…')
    this.card.append(this.logoWrap, this.wordmark, this.spinner, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress arc.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.logoWrap, this.wordmark, this.spinner, this.hint)
      }
      return
    }
    const report = div(css.failed)
    report.append(div(css.failedTitle, 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.logoWrap, this.wordmark, report)
  }

  /** Grow the rotating arc monotonically as loader entries activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.spinner.style.setProperty('--fathom-boot-arc', `${String(Math.round(72 + ratio * 216))}deg`)
  }
}
