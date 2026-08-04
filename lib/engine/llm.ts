import { z } from 'zod'

/**
 * A thin provider seam for the two things the engine asks a language model to
 * do: answer a question *with live search grounding* (the AI-visibility probe),
 * and produce a schema-constrained object (asset generation).
 *
 * It is deliberately small. The engine's judgment lives in detectors and
 * scoring, which are deterministic; the model is used for retrieval-grounded
 * observation and for drafting. Keeping the surface this narrow is what makes
 * the provider swappable — and it means a vendor outage degrades one evidence
 * family rather than the system.
 */

export interface GroundedAnswer {
  text: string
  /** URLs the provider actually cited, the signal the probe measures */
  citations: string[]
  model: string
}

export interface LlmProvider {
  name: string
  /** null when usable, otherwise why it is not */
  unavailableReason(): string | null
  /**
   * Whether this provider can answer with live web search.
   *
   * The probe treats this as a hard requirement rather than a nice-to-have.
   * Every property here launched after any model's training cutoff, so an
   * ungrounded model cannot cite them however well they perform: the probe
   * would report a permanent zero and look like a working metric. A provider
   * that cannot ground is not a degraded probe, it is a wrong one.
   */
  supportsGrounding(): boolean
  answerGrounded(prompt: string): Promise<GroundedAnswer>
  /** Draft against a schema; the caller validates and may reject. */
  generateObject<T>(args: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    schemaName: string
  }): Promise<T>
}

// ---------------------------------------------------------------------------
// OpenAI Responses API — the route where grounding is genuinely available.
// ---------------------------------------------------------------------------

const OPENAI_URL = 'https://api.openai.com/v1/responses'

interface ResponsesContent {
  type: string
  text?: string
  annotations?: { type: string; url?: string }[]
}

interface ResponsesPayload {
  model?: string
  output?: { type: string; content?: ResponsesContent[] }[]
  output_text?: string
  error?: { message: string }
}

function responsesText(payload: ResponsesPayload): string {
  if (payload.output_text) return payload.output_text
  const parts: string[] = []
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text)
    }
  }
  return parts.join('\n').trim()
}

function responsesCitations(payload: ResponsesPayload): string[] {
  const urls: string[] = []
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.url) urls.push(annotation.url)
      }
    }
  }
  return [...new Set(urls)]
}

export function openAiProvider(): LlmProvider {
  const model = process.env.OPENAI_MODEL ?? 'gpt-5'

  async function call(body: Record<string, unknown>): Promise<ResponsesPayload> {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, ...body }),
    })
    const payload = (await res.json()) as ResponsesPayload
    if (!res.ok) {
      throw new Error(`openai ${res.status}: ${payload.error?.message ?? 'request failed'}`)
    }
    return payload
  }

  return {
    name: `openai:${model}`,

    unavailableReason() {
      return process.env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY not set'
    },

    supportsGrounding() {
      // The Responses API exposes web_search as a first-class tool, and
      // returns the URLs it consulted as annotations — which is exactly what
      // the probe measures. This is the reason to prefer this route.
      return process.env.LLM_GROUNDING !== 'off'
    },

    async answerGrounded(prompt) {
      const payload = await call({ input: prompt, tools: [{ type: 'web_search' }] })
      return {
        text: responsesText(payload),
        citations: responsesCitations(payload),
        model: payload.model ?? model,
      }
    },

    async generateObject({ system, prompt, schema, schemaName }) {
      const payload = await call({
        input: [
          { role: 'system', content: `${system}\n\nRespond with a single JSON object and nothing else.` },
          { role: 'user', content: prompt },
        ],
      })
      void schemaName
      const text = responsesText(payload)
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/, '')
      return schema.parse(JSON.parse(text))
    },
  }
}

/**
 * Provider selection by available credential.
 *
 * One route, behind the `LlmProvider` interface. OpenAI is the provider
 * because its Responses API genuinely exposes web search and returns the URLs
 * it consulted, and the AI-visibility probe is worthless without that: an
 * ungrounded model answering "which apps do you recommend" reports its
 * training data, not what an assistant tells a user today.
 *
 * The seam stays narrow rather than disappearing. Adding a second provider is
 * one more object implementing these two methods, which is why the interface
 * exists at all.
 *
 * LLM_PROVIDER=none forces the disabled route for tests and offline runs.
 */
export function getProvider(): LlmProvider {
  if (process.env.LLM_PROVIDER === 'none') return disabledProvider()
  return openAiProvider()
}

/**
 * An explicit "no model" route.
 *
 * Tests and offline runs need a way to say so, rather than relying on the
 * absence of a credential — a developer's key in the environment should not
 * silently turn a deterministic test suite into one that makes paid network
 * calls and returns different output each run.
 */
function disabledProvider(): LlmProvider {
  return {
    name: 'disabled',
    unavailableReason: () => 'LLM_PROVIDER=none',
    supportsGrounding: () => false,
    answerGrounded: () => Promise.reject(new Error('LLM disabled')),
    generateObject: () => Promise.reject(new Error('LLM disabled')),
  }
}
