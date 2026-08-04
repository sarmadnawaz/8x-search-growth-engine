import { describe, it, expect } from 'vitest'
import { MAKERS, makerFor } from '@/lib/engine/makers'
import { evaluateCheck, type CheckContext } from '@/lib/engine/checks'
import { PropertyConfig } from '@/lib/schemas'
import type { MakerContext } from '@/lib/engine/makers/types'

/**
 * The contract for every maker: whatever it produces must pass the acceptance
 * criteria it claims to satisfy.
 *
 * Without this, a maker can emit plausible-looking filler and the failure only
 * shows up in production as an action that never verifies. Here the generated
 * page is served straight back to the real check implementations, so
 * generation and verification are held to the same standard.
 */

const config = PropertyConfig.parse({
  domain: 'example.com',
  name: 'Example',
  description: 'A wardrobe app that plans outfits from clothes you already own',
  goal: 'app_installs',
  conversionRoute: 'app_store_link',
  markets: [{ market: 'us', language: 'en' }],
  seedQueries: ['outfit planner app', 'digital wardrobe', 'what to wear'],
})

function context(subject: string): MakerContext {
  return {
    config,
    subject,
    evidence: {
      competitors: [
        { position: 1, url: 'https://rival.example/a', title: 'Rival A' },
        { position: 4, url: 'https://rival.example/b', title: 'Rival B' },
      ],
      relatedQueries: ['outfit planner app free', 'outfit planner app reddit', 'best outfit app'],
      demand: 7.4,
      intent: 'commercial',
    },
    // No enrichment: the deterministic template must stand on its own, since a
    // missing key or provider outage must not produce an unpublishable asset.
    enrich: undefined,
  }
}

/** Serve the generated asset back to the real check implementations. */
function serving(body: string): CheckContext {
  return {
    domain: config.domain,
    baseUrl: 'http://test',
    windowDays: 14,
    fetchPath: async () => ({ status: 200, body }),
  }
}

describe('every maker produces an asset that passes its own criteria', () => {
  for (const maker of MAKERS) {
    it(`${maker.kind}`, async () => {
      const asset = await maker.make(context('outfit planner app'))

      expect(asset.body.length).toBeGreaterThan(200)
      expect(asset.path).toBeTruthy()

      for (const criterion of asset.satisfies) {
        const result = await evaluateCheck(criterion, serving(asset.body), 0)
        expect(result.passed, `${maker.kind} fails its own "${criterion}": ${result.observed}`).toBe(
          true,
        )
      }
    })
  }
})

describe('generated pages carry the structure search and answer engines read', () => {
  it('puts a direct answer under a question heading', async () => {
    const asset = await makerFor('publish_landing_page')!.make(context('outfit planner app'))
    expect(asset.body).toMatch(/<h2>What is the best outfit planner app\?<\/h2>/)
    expect(asset.body).toContain('class="answer"')
  })

  it('renders comparisons as a real table, not a grid of divs', async () => {
    const asset = await makerFor('publish_comparison_page')!.make(context('outfit planner app'))
    expect(asset.body).toContain('<table>')
    expect(asset.body).toContain('<th scope="row">')
  })

  it('server-renders the tool explanation, since answer engines do not run JS', async () => {
    const asset = await makerFor('build_free_tool')!.make(context('outfit planner app'))
    const withoutScripts = asset.body.replace(/<script[\s\S]*?<\/script>/gi, '')
    expect(withoutScripts).toContain('How it works')
    expect(withoutScripts.length).toBeGreaterThan(600)
  })

  it('cites only competitors that were actually observed', async () => {
    const asset = await makerFor('publish_landing_page')!.make(context('outfit planner app'))
    expect(asset.body).toContain('rival.example')
    // Nothing invented: the page must not name a competitor absent from evidence.
    expect(asset.body).not.toMatch(/competitor[- ]?c/i)
  })
})

describe('a maker declines rather than shipping something useless', () => {
  it('returns a brief when no utility shape fits the query', async () => {
    const asset = await makerFor('build_free_tool')!.make(context('quarterly board reporting'))
    // A generic "items x rate" calculator would rank for a query it cannot
    // answer, which is worse than publishing nothing.
    expect(asset.path).toMatch(/\.brief\.md$/)
    expect(asset.body).toContain('has no utility template')
    expect(asset.satisfies).toEqual([])
  })

  it('builds a real calculator when the query matches a known job', async () => {
    const asset = await makerFor('build_free_tool')!.make(context('wardrobe cost per wear'))
    expect(asset.path).toMatch(/\.html$/)
    expect(asset.body).toContain('cost per wear')
  })
})
