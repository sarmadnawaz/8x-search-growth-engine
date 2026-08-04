import type { Server } from 'node:http'
import { prisma } from '../db'
import { EvidenceInput, PropertyConfig } from '../schemas'
import { loadProperty } from './config'
import { startLocalSite } from './localSite'
import { crawlerAdapter } from './adapters/crawler'
import { autocompleteAdapter } from './adapters/autocomplete'
import { serpAdapter } from './adapters/serp'
import { psiAdapter } from './adapters/psi'
import { aiProbeAdapter } from './adapters/aiProbe'
import type { Adapter, AdapterContext, ClusterInput } from './adapters/types'

export const ENGINE_VERSION = '0.1.0'

/**
 * Collection order matters: autocomplete discovers clusters, and the SERP
 * adapter samples them. Everything else is independent.
 */
const ADAPTERS: Adapter[] = [
  crawlerAdapter,
  autocompleteAdapter,
  serpAdapter,
  psiAdapter,
  aiProbeAdapter,
]

export interface RunOptions {
  domain: string
  mode: 'live' | 'replay'
  log?: (message: string) => void
}

export interface RunSummary {
  snapshotId: string
  domain: string
  pages: number
  clusters: number
  evidence: number
  degraded: string[]
}

function baseUrlFor(config: PropertyConfig): string {
  return config.localSite
    ? `http://127.0.0.1:${config.localSite.port}`
    : `https://${config.domain}`
}

/** Property rows mirror the YAML so evidence has something to key off. */
async function upsertProperty(config: PropertyConfig) {
  await prisma.property.upsert({
    where: { domain: config.domain },
    create: {
      domain: config.domain,
      name: config.name,
      goal: config.goal,
      conversionRoute: config.conversionRoute,
      publishingPolicy: config.publishingPolicy,
      configJson: JSON.stringify(config),
    },
    update: {
      name: config.name,
      goal: config.goal,
      conversionRoute: config.conversionRoute,
      publishingPolicy: config.publishingPolicy,
      configJson: JSON.stringify(config),
    },
  })
}

export async function collect(options: RunOptions): Promise<RunSummary> {
  const log = options.log ?? ((m: string) => console.log(`  ${m}`))
  const config = loadProperty(options.domain)
  await upsertProperty(config)

  const snapshot = await prisma.snapshot.create({
    data: { domain: config.domain, engineVersion: ENGINE_VERSION, status: 'pending' },
  })

  let server: Server | undefined
  if (config.localSite) {
    server = await startLocalSite(config.localSite.dir, config.localSite.port)
    log(`serving ${config.localSite.dir} on port ${config.localSite.port}`)
  }

  const clusters: ClusterInput[] = []
  const degraded: string[] = []
  let evidenceCount = 0
  let pageCount = 0

  try {
    for (const adapter of ADAPTERS) {
      const ctx: AdapterContext = {
        config,
        snapshotId: snapshot.id,
        mode: options.mode,
        baseUrl: baseUrlFor(config),
        clusters,
        log: (m) => log(`[${adapter.name}] ${m}`),
        record: async (call) => {
          await prisma.adapterCall.upsert({
            where: {
              snapshotId_adapter_requestKey: {
                snapshotId: snapshot.id,
                adapter: call.adapter,
                requestKey: call.requestKey,
              },
            },
            create: { snapshotId: snapshot.id, ...call },
            update: {},
          })
        },
      }

      const reason = adapter.unavailableReason(ctx)
      if (reason) {
        degraded.push(`${adapter.name}: ${reason}`)
        log(`[${adapter.name}] skipped — ${reason}`)
        continue
      }

      const stage = await prisma.run.create({
        data: { domain: config.domain, stage: `collect:${adapter.name}` },
      })

      try {
        const result = await adapter.collect(ctx)

        for (const page of result.pages ?? []) {
          await prisma.page.upsert({
            where: { snapshotId_url: { snapshotId: snapshot.id, url: page.url } },
            create: {
              snapshotId: snapshot.id,
              domain: config.domain,
              url: page.url,
              status: page.status,
              indexable: page.indexable,
              title: page.title,
              metaDescription: page.metaDescription,
              h1: page.h1,
              canonical: page.canonical,
              robotsMeta: page.robotsMeta,
              schemaTypesJson: JSON.stringify(page.schemaTypes),
              internalLinks: page.internalLinks,
              wordCount: page.wordCount,
              rawTextLength: page.rawTextLength,
            },
            update: {},
          })
          pageCount++
        }

        for (const cluster of result.clusters ?? []) {
          const row = await prisma.queryCluster.upsert({
            where: {
              domain_market_query: {
                domain: config.domain,
                market: cluster.market,
                query: cluster.query,
              },
            },
            create: { domain: config.domain, ...cluster },
            update: { demand: cluster.demand, demandSource: cluster.demandSource },
          })
          if (!clusters.some((c) => c.query === cluster.query && c.market === cluster.market)) {
            clusters.push({ ...cluster })
          }
          void row
        }

        for (const item of result.evidence) {
          const parsed = EvidenceInput.parse(item)
          const cluster = parsed.clusterId
            ? null
            : await prisma.queryCluster.findFirst({
                where: { domain: config.domain, query: parsed.subject },
              })
          await prisma.evidence.create({
            data: {
              domain: config.domain,
              snapshotId: snapshot.id,
              kind: parsed.kind,
              source: parsed.source,
              tier: parsed.tier,
              subject: parsed.subject,
              valueJson: JSON.stringify(parsed.value),
              clusterId: parsed.clusterId ?? cluster?.id,
              rawRef: parsed.rawRef,
            },
          })
          evidenceCount++
        }

        await prisma.run.update({
          where: { id: stage.id },
          data: { status: 'done', finishedAt: new Date() },
        })
      } catch (err) {
        // One adapter failing degrades its evidence family; it never fails the
        // run. Downstream detectors see the gap and score accordingly.
        const message = err instanceof Error ? err.message : String(err)
        degraded.push(`${adapter.name}: ${message}`)
        log(`[${adapter.name}] FAILED — ${message}`)
        await prisma.run.update({
          where: { id: stage.id },
          data: { status: 'failed', detail: message, finishedAt: new Date() },
        })
      }
    }
  } finally {
    server?.close()
  }

  await prisma.snapshot.update({
    where: { id: snapshot.id },
    data: {
      status: degraded.length > 0 ? 'partial' : 'complete',
      finishedAt: new Date(),
      degradedJson: JSON.stringify(degraded),
    },
  })

  return {
    snapshotId: snapshot.id,
    domain: config.domain,
    pages: pageCount,
    clusters: clusters.length,
    evidence: evidenceCount,
    degraded,
  }
}
