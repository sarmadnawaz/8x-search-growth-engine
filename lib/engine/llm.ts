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
// Vercel AI Gateway — one key, many providers, OpenAI-compatible surface.
// ---------------------------------------------------------------------------

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'

/** Models are `provider/model`; the gateway routes on the prefix. */
const DEFAULT_MODEL = 'google/gemini-2.5-flash'

interface ChatChoice {
  message?: {
    content?: string
    annotations?: { url_citation?: { url: string } }[]
  }
}

interface ChatResponse {
  model?: string
  choices?: ChatChoice[]
  error?: { message: string; type?: string }
}

/** Pull URLs out of citation annotations, falling back to links in the prose. */
function citationsFrom(payload: ChatResponse, text: string): string[] {
  const annotated = (payload.choices ?? [])
    .flatMap((c) => c.message?.annotations ?? [])
    .map((a) => a.url_citation?.url)
    .filter((u): u is string => Boolean(u))

  if (annotated.length > 0) return [...new Set(annotated)]

  // Grounded answers often carry sources inline; a URL in the text is weaker
  // evidence than an annotation, but it is still something the model chose to
  // surface rather than something we inferred.
  const inline = text.match(/https?:\/\/[^\s)\]"']+/g) ?? []
  return [...new Set(inline)]
}

export function gatewayProvider(): LlmProvider {
  const model = process.env.LLM_MODEL ?? DEFAULT_MODEL

  async function call(body: Record<string, unknown>): Promise<ChatResponse> {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, ...body }),
    })
    const payload = (await res.json()) as ChatResponse
    if (!res.ok) {
      throw new Error(`gateway ${res.status}: ${payload.error?.message ?? 'request failed'}`)
    }
    return payload
  }

  return {
    name: `gateway:${model}`,

    unavailableReason() {
      return process.env.AI_GATEWAY_API_KEY ? null : 'AI_GATEWAY_API_KEY not set'
    },

    supportsGrounding() {
      // Opt-in, and off by default — deliberately.
      //
      // Google Search grounding is a Gemini capability, but the gateway's
      // OpenAI-compatible chat surface rejects the grounding tool
      // (`400 Invalid input: expected "function"`), so it is not reachable
      // the way a plain tool call would suggest. Defaulting this to true would
      // have the engine assert a capability nobody has observed — the same
      // mistake it refuses to make about a domain's rankings.
      //
      // Set LLM_GROUNDING=on once grounded answers are confirmed to return
      // citations on this route; until then the probe declines to run.
      return process.env.LLM_GROUNDING === 'on'
    },

    async answerGrounded(prompt) {
      const payload = await call({
        messages: [{ role: 'user', content: prompt }],
        // Only sent when grounding is confirmed available: an unsupported tool
        // makes the whole request invalid, which would take out the enrichment
        // path as well.
        ...(process.env.LLM_GROUNDING === 'on'
          ? { tools: [{ type: 'google_search' }] }
          : {}),
      })

      const text = payload.choices?.[0]?.message?.content ?? ''
      return { text, citations: citationsFrom(payload, text), model: payload.model ?? model }
    },

    async generateObject({ system, prompt, schema, schemaName }) {
      const payload = await call({
        messages: [
          {
            role: 'system',
            content: `${system}\n\nRespond with a single JSON object and nothing else.`,
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      })

      const text = payload.choices?.[0]?.message?.content ?? ''
      // Models wrap JSON in fences often enough that stripping them is cheaper
      // than a retry, but the model is never trusted to have produced the
      // right shape — the caller's schema decides.
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/, '')
      void schemaName
      return schema.parse(JSON.parse(cleaned))
    },
  }
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
 * Both routes implement the same two methods, so which one runs is
 * configuration rather than a code path — the point of keeping this seam
 * narrow. OpenAI is preferred when its key is present because its Responses
 * API genuinely exposes web search and returns the URLs it consulted, and the
 * probe is worthless without that. The gateway is the alternative when one key
 * has to cover many models.
 *
 * LLM_PROVIDER forces a choice when both keys exist.
 */
export function getProvider(): LlmProvider {
  const forced = process.env.LLM_PROVIDER
  if (forced === 'none') return disabledProvider()
  if (forced === 'openai') return openAiProvider()
  if (forced === 'gateway') return gatewayProvider()

  return process.env.OPENAI_API_KEY ? openAiProvider() : gatewayProvider()
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
