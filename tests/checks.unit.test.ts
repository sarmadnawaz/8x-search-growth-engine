import { describe, it, expect } from 'vitest'
import { evaluateCheck, classOf, SUPPORTED_CHECKS, type CheckContext } from '@/lib/engine/checks'

/**
 * The check vocabulary is where "done" is defined, so it gets tested against
 * hand-written pages whose expected verdict is obvious by reading them.
 *
 * `fetchPath` is injected, so delivery checks are testable without a server —
 * which is the reason the context takes a function rather than a base URL.
 */

function contextServing(pages: Record<string, string>, status = 200): CheckContext {
  return {
    domain: 'example.com',
    baseUrl: 'http://test',
    windowDays: 14,
    fetchPath: async (path) => ({ status, body: pages[path] ?? pages['/'] ?? '' }),
  }
}

describe('check classification', () => {
  it('separates delivery from outcome, because only delivery may mark work done', () => {
    expect(classOf('http_status:/robots.txt=200')).toBe('delivery')
    expect(classOf('answer_block_present')).toBe('delivery')
    expect(classOf('rank_within:widget=10')).toBe('outcome')
    expect(classOf('probe_inclusion:best widget?=0.5')).toBe('outcome')
  })

  it('exposes the full vocabulary so a detector cannot invent an unknown check', () => {
    expect(SUPPORTED_CHECKS).toContain('sourced_stats')
    expect(SUPPORTED_CHECKS).toContain('rank_within')
    expect(SUPPORTED_CHECKS.length).toBeGreaterThan(8)
  })

  it('fails loudly on an unsupported check rather than quietly passing', async () => {
    const result = await evaluateCheck('made_up_check:1', contextServing({ '/': '' }), 0)
    expect(result.passed).toBe(false)
    expect(result.observed).toContain('unsupported')
  })
})

describe('answer_block_present', () => {
  it('accepts a question heading followed by a real answer', async () => {
    const page = `<h2>What is envelope budgeting?</h2><p>${'word '.repeat(60)}</p>`
    const result = await evaluateCheck('answer_block_present', contextServing({ '/': page }), 0)
    expect(result.passed).toBe(true)
  })

  it('rejects a question heading with nothing under it', async () => {
    const page = '<h2>What is envelope budgeting?</h2><p>Short.</p>'
    const result = await evaluateCheck('answer_block_present', contextServing({ '/': page }), 0)
    expect(result.passed).toBe(false)
  })

  it('rejects a page whose headings are not questions', async () => {
    const page = `<h2>Our product</h2><p>${'word '.repeat(60)}</p>`
    const result = await evaluateCheck('answer_block_present', contextServing({ '/': page }), 0)
    expect(result.passed).toBe(false)
    expect(result.observed).toContain('none question-shaped')
  })
})

describe('sourced_stats', () => {
  it('requires the figure and its source in the same block, not merely on the same page', async () => {
    // Ten figures in one paragraph and a link in the footer sources nothing.
    const detached = `
      <p>Engagement rose 40%, CPM fell 12%, reach grew 3x, retention gained 8%.</p>
      <p><a href="https://study.example/a">Our sources</a></p>`
    const result = await evaluateCheck('sourced_stats:3', contextServing({ '/': detached }), 0)
    expect(result.passed).toBe(false)
  })

  it('passes when each figure is backed by an outbound citation', async () => {
    const sourced = `
      <p>Engagement rose 40% (<a href="https://study.example/a">source</a>).</p>
      <p>CPM fell 12% (<a href="https://study.example/b">source</a>).</p>
      <p>Reach grew 3x (<a href="https://study.example/c">source</a>).</p>`
    const result = await evaluateCheck('sourced_stats:3', contextServing({ '/': sourced }), 0)
    expect(result.passed).toBe(true)
  })
})

describe('schema_type_present', () => {
  it('finds a declared type', async () => {
    const page = `<script type="application/ld+json">{"@type":"FAQPage"}</script>`
    const result = await evaluateCheck('schema_type_present:FAQPage', contextServing({ '/': page }), 0)
    expect(result.passed).toBe(true)
  })

  it('treats invalid JSON-LD as absent, which is what a consumer sees', async () => {
    const page = `<script type="application/ld+json">{ not json }</script>`
    const result = await evaluateCheck('schema_type_present:FAQPage', contextServing({ '/': page }), 0)
    expect(result.passed).toBe(false)
    expect(result.observed).toContain('no valid JSON-LD')
  })
})

describe('delivery checks report what they saw, not just a verdict', () => {
  it('records the observed status so a reviewer can reproduce it', async () => {
    const ctx = contextServing({ '/robots.txt': '' }, 404)
    const result = await evaluateCheck('http_status:/robots.txt=200', ctx, 0)
    expect(result.passed).toBe(false)
    expect(result.observed).toBe('HTTP 404')
  })

  it('counts initial-HTML text, which is what an answer engine can read', async () => {
    const ctx = contextServing({ '/': '<div><script>ignored()</script>hello world</div>' })
    const result = await evaluateCheck('min_text_length:/=500', ctx, 0)
    expect(result.passed).toBe(false)
    expect(result.observed).toContain('chars of initial-HTML text')
  })
})
