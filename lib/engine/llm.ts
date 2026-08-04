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
  /** URLs the provider actually cited — the signal the probe measures */
  citations: string[]
  model: string
}

export interface LlmProvider {
  name: string
  /** null when usable, otherwise why it is not */
  unavailableReason(): string | null
  /**
   * Answer with live web search. Grounding is not optional for the probe:
   * every 8x property post-dates any model's training cutoff, so an ungrounded
   * model cannot cite them however well the property performs. An ungrounded
   * probe would measure parametric memory and report a permanent zero.
   */
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
// OpenAI (Responses API). `web_search` is what makes the probe meaningful.
// ---------------------------------------------------------------------------

const OPENAI_URL = 'https://api.openai.com/v1/responses'

interface ResponsesOutputContent {
  type: string
  text?: string
  annotations?: { type: string; url?: string }[]
}

interface ResponsesPayload {
  model?: string
  output?: { type: string; content?: ResponsesOutputContent[] }[]
  output_text?: string
  error?: { message: string }
}

function extractText(payload: ResponsesPayload): string {
  if (payload.output_text) return payload.output_text
  const parts: string[] = []
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text)
    }
  }
  return parts.join('\n').trim()
}

function extractCitations(payload: ResponsesPayload): string[] {
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
    if (!res.ok) throw new Error(`openai ${res.status}: ${payload.error?.message ?? 'request failed'}`)
    return payload
  }

  return {
    name: 'openai',

    unavailableReason() {
      return process.env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY not set'
    },

    async answerGrounded(prompt) {
      const payload = await call({
        input: prompt,
        tools: [{ type: 'web_search' }],
      })
      return {
        text: extractText(payload),
        citations: extractCitations(payload),
        model: payload.model ?? model,
      }
    },

    async generateObject({ system, prompt, schema, schemaName }) {
      const payload = await call({
        input: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: false,
            schema: toJsonSchema(schema),
          },
        },
      })

      const text = extractText(payload)
      // The model is never trusted to have produced the right shape: parse and
      // let the caller's QA gate reject on failure.
      return schema.parse(JSON.parse(text))
    },
  }
}

/**
 * Minimal Zod -> JSON Schema conversion covering the shapes the makers use.
 * A dependency would do more, but the asset schemas are small and explicit,
 * and this keeps the seam free of one.
 */
function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string } })._def

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = toJsonSchema(field as z.ZodType<unknown>)
        if (!(field as z.ZodTypeAny).isOptional()) required.push(key)
      }
      return { type: 'object', properties, required, additionalProperties: false }
    }
    case 'ZodArray':
      return {
        type: 'array',
        items: toJsonSchema((def as unknown as { type: z.ZodType<unknown> }).type),
      }
    case 'ZodEnum':
      return { type: 'string', enum: (def as unknown as { values: string[] }).values }
    case 'ZodNumber':
      return { type: 'number' }
    case 'ZodBoolean':
      return { type: 'boolean' }
    case 'ZodOptional':
    case 'ZodDefault':
      return toJsonSchema((def as unknown as { innerType: z.ZodType<unknown> }).innerType)
    default:
      return { type: 'string' }
  }
}

/**
 * Provider selection. Anthropic slots in behind the same interface — the
 * production tiering in the design (cheap model for extraction, mid for
 * drafting, top for evaluation) is a routing policy inside a provider, not a
 * different shape of call.
 */
export function getProvider(): LlmProvider {
  return openAiProvider()
}
