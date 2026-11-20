/**
 * FindingsDock: a findings summary docked above the message composer. Collapsed,
 * it shows severity count tiles; expanded, it shows a filterable finding list and
 * a detail pane with how each issue was found, why it happens, how to reproduce
 * it and how to fix it. Live state arrives as the `findings` session projection;
 * before the first finding (null/undefined) or an empty list it renders nothing.
 */

import { useMemo, useState } from 'react'
import type { Finding, Severity } from '@fathom/tool-findings/client'
import type { PropsLocale } from '@fathom/client-ui-slots'
import css from './FindingsDock.module.css'

/** Highest severity first. */
const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

/** Per-severity accent colour. */
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#f43f5e',
  high: '#fb923c',
  medium: '#facc15',
  low: '#38bdf8',
  info: '#94a3b8',
}

/** Per-severity count plus the total. */
interface Counts {
  readonly total: number
  readonly bySeverity: Record<Severity, number>
}

/** Tally findings by severity. */
function tally(findings: readonly Finding[]): Counts {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of findings) bySeverity[finding.severity] += 1
  return { total: findings.length, bySeverity }
}

/** Findings sorted by descending severity, stable within a rating. */
function bySeverityDesc(findings: readonly Finding[]): Finding[] {
  const rank = (s: Severity): number => SEVERITY_ORDER.indexOf(s)
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity))
}

/** Full props of the dock entry: the session standard kit plus the locale seat. */
export type FindingsDockProps =
  import('@fathom/client-ui-slots').PropsRuntime<'conversation.input.dock'> & PropsLocale<'findings'>

/** One titled detail block. */
function Section(props: { title: string; body: string }) {
  return (
    <section className={css.section}>
      <h4 className={css.sectionTitle}>{props.title}</h4>
      <p className={css.sectionBody}>{props.body}</p>
    </section>
  )
}

/** Dock adapter: reads the host-computed `findings` projection and renders the summary + detail. */
export function FindingsDock({ useProjection, t }: FindingsDockProps) {
  const findings = useProjection('findings')
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Severity | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const list: readonly Finding[] = findings ?? []
  const counts = useMemo(() => tally(list), [list])
  const visible = useMemo(
    () => bySeverityDesc(filter === null ? list : list.filter(f => f.severity === filter)),
    [list, filter],
  )

  if (findings === undefined || findings === null || findings.length === 0) return null

  const current = selected === null ? undefined : list.find(f => f.id === selected)

  return (
    <div className={css.root}>
      <button type="button" className={css.header} onClick={() => setOpen(value => !value)}
        aria-label={open ? t('toggle.close') : t('toggle.open')} aria-expanded={open}>
        <span className={css.flag} aria-hidden>⚑</span>
        <span className={css.title}>{t('title')}</span>
        <span className={css.total}>{counts.total}</span>
        <span className={css.chips}>
          {SEVERITY_ORDER.filter(s => counts.bySeverity[s] > 0).map(s => (
            <span key={s} className={css.chip} style={{ color: SEVERITY_COLOR[s] }}>
              <span className={css.dot} style={{ background: SEVERITY_COLOR[s] }} />{counts.bySeverity[s]}
            </span>
          ))}
        </span>
        <span className={css.caret} aria-hidden>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className={css.body}>
          <div className={css.tiles}>
            <button type="button" className={`${css.tile} ${filter === null ? css.tileActive : ''}`}
              onClick={() => { setFilter(null) }}>
              <span className={css.tileN}>{counts.total}</span>
              <span className={css.tileK}>{t('filter.all')}</span>
            </button>
            {SEVERITY_ORDER.map(s => (
              <button key={s} type="button" className={`${css.tile} ${filter === s ? css.tileActive : ''}`}
                onClick={() => { setFilter(prev => prev === s ? null : s) }}>
                <span className={css.tileN} style={{ color: SEVERITY_COLOR[s] }}>{counts.bySeverity[s]}</span>
                <span className={css.tileK}>{s}</span>
              </button>
            ))}
          </div>

          <div className={css.panes}>
            <ul className={css.list}>
              {visible.map(f => (
                <li key={f.id}>
                  <button type="button" className={`${css.row} ${selected === f.id ? css.rowActive : ''}`}
                    style={{ borderLeftColor: SEVERITY_COLOR[f.severity] }}
                    onClick={() => { setSelected(f.id) }}>
                    <span className={css.rowTitle}>{f.id} — {f.title}</span>
                    <span className={css.rowMeta}>
                      <span style={{ color: SEVERITY_COLOR[f.severity] }}>{f.severity}</span>
                      <span className={css.muted}>{f.status}</span>
                      {f.target !== undefined && <span className={css.muted}>· {f.target}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className={css.detail}>
              {current === undefined
                ? <p className={css.hint}>{t('empty.selected')}</p>
                : (
                  <>
                    <h3 className={css.detailTitle}>{current.id} — {current.title}</h3>
                    <div className={css.badges}>
                      <span className={css.badge} style={{ color: SEVERITY_COLOR[current.severity] }}>{current.severity}</span>
                      <span className={css.badge}>{current.status}</span>
                      {current.target !== undefined && <span className={css.badge}>{current.target}</span>}
                      {current.cwe !== undefined && <span className={css.badge}>{current.cwe}</span>}
                    </div>
                    <Section title={t('section.why')} body={current.description} />
                    {current.impact !== undefined && <Section title={t('section.impact')} body={current.impact} />}
                    {current.reproduction !== undefined && <Section title={t('section.reproduce')} body={current.reproduction} />}
                    {current.remediation !== undefined && <Section title={t('section.fix')} body={current.remediation} />}
                    {current.evidence.length > 0 && (
                      <section className={css.section}>
                        <h4 className={css.sectionTitle}>{t('section.evidence')} ({current.evidence.length})</h4>
                        {current.evidence.map((e, i) => (
                          <div key={i} className={css.ev}>
                            <div className={css.evSummary}>{e.summary}</div>
                            {(e.quotes ?? []).map((q, qi) => <blockquote key={qi} className={css.quote}>{q}</blockquote>)}
                            {e.request !== undefined && (
                              <><div className={css.evLabel}>{t('label.request')}</div><pre className={css.pre}>{e.request}</pre></>
                            )}
                            {e.response !== undefined && (
                              <><div className={css.evLabel}>{t('label.response')}</div><pre className={css.pre}>{e.response}</pre></>
                            )}
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
