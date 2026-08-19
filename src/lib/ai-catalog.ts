/**
 * What a provider *is*, what models it has, and which knobs those models take.
 *
 * `ai.ts` decides who answers. This decides what the admin screen can offer
 * before anyone has answered anything: the handful of vendors worth a preset,
 * the shape their `/models` listing comes back in, and the sampling parameters
 * a request is allowed to carry.
 *
 * It is a separate module for the same reason `content-schema.ts` is: two of
 * the three things in here are trust boundaries, and a trust boundary has to be
 * callable from a plain Node script. `npm run check:ai` imports this file
 * directly.
 *
 *   - **`clampParams()` is an allowlist, not a filter.** Whatever it returns is
 *     spread into the outbound request body. A caller-supplied key that reached
 *     it would be a caller-supplied *field on the vendor's API* — `max_tokens`
 *     being the obvious one, because that is the spend ceiling this site sets
 *     and the settings screen is explicitly not allowed to lift its own limits
 *     (decision 22). So the keys come from `PARAM_SPECS` in source, never from
 *     the row, and every value is clamped to the range beside it.
 *   - **`normaliseModels()` reads a third party's JSON.** It is fed whatever a
 *     vendor's `/models` returns, which is not a shape this repo controls and
 *     is occasionally not the documented one. Every field is read defensively
 *     and nothing it produces is ever interpolated anywhere — the model id it
 *     returns lands in a `<option>`'s text and in a request body, both as data.
 *
 * There is deliberately no vendor adapter here either, for the same reason
 * `ai.ts` has none: `GET {base_url}/models` returning `{ data: [...] }` is as
 * universal as `/chat/completions`, and the fields that differ between vendors
 * differ by *name*, which is a list of aliases rather than a class hierarchy.
 */

/* ---------- presets ---------- */

/**
 * A vendor worth not making the owner type a URL for.
 *
 * The base URL is the only field that has to be right; everything else on the
 * dialog is a convenience. `custom` is last and is what keeps this list from
 * being a gate — the row still stores a free-text URL, so a provider nobody has
 * heard of is one paste away and does not need a release.
 *
 * `sample` is a model that existed on that vendor when this was written. It is
 * a placeholder, never a default: a stale placeholder is a hint that has aged,
 * a stale default is a 404 on the first question.
 */
export interface ProviderPreset {
  /** Also the suggested row key. Lowercase words joined by hyphens. */
  id: string;
  label: string;
  baseUrl: string;
  /** Where the owner gets a key, linked from the dialog. Empty for local ones. */
  keyUrl: string;
  sample: string;
  /** Shown under the picker, so "which of these do I want" has an answer. */
  note: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    sample: 'anthropic/claude-3.5-haiku',
    note: 'One key, several hundred models, and the only listing that carries prices — which is what the free filter reads.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    sample: 'gpt-4o-mini',
    note: 'The reference implementation of this API. Its listing carries ids and nothing else.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    sample: 'llama-3.3-70b-versatile',
    note: 'Fast, small selection, generous free tier.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    sample: 'deepseek-chat',
    note: 'Cheap, and the reasoning model puts its thinking in its own field rather than in the answer.',
  },
  {
    id: 'together',
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    sample: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    note: 'Open-weight models, hosted.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    sample: 'mistral-small-latest',
    note: 'European hosting, small models that draft well.',
  },
  {
    id: 'xai',
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    sample: 'grok-3-mini',
    note: 'Grok, through the same request shape as everything else here.',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyUrl: 'https://cloud.cerebras.ai',
    sample: 'llama3.1-8b',
    note: 'The fastest tokens per second of any of these, on a short list of models.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    keyUrl: '',
    sample: 'llama3.2',
    note: 'Only reachable from a machine running it — a deployed Worker cannot see localhost.',
  },
  {
    id: 'custom',
    label: 'Something else',
    baseUrl: '',
    keyUrl: '',
    sample: '',
    note: 'Any endpoint that answers POST {base}/chat/completions in the OpenAI shape.',
  },
];

export const presetFor = (id: string): ProviderPreset | null =>
  PROVIDER_PRESETS.find(preset => preset.id === id) ?? null;

/** The preset a stored base URL came from, so Edit opens on the right one. */
export function presetForUrl(baseUrl: string): ProviderPreset {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return (
    PROVIDER_PRESETS.find(preset => preset.baseUrl && preset.baseUrl === trimmed) ??
    PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
  );
}

/* ---------- the model catalog ---------- */

/**
 * One row of a vendor's `/models`, in the fields this site has a use for.
 *
 * Everything except `id` is optional in practice, because most vendors return
 * an id, an `object: "model"` and nothing else. The picker degrades to a
 * searchable list of ids when that is all there is, which is still better than
 * a text field the owner has to spell a model into from memory.
 */
export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  /** Tokens of context, when the listing says. */
  contextLength: number | null;
  /** USD per million tokens. `0` is free; `null` is "the vendor did not say". */
  promptPrice: number | null;
  completionPrice: number | null;
  free: boolean;
  /** Sampling parameters the vendor says this model accepts. May be empty. */
  supported: string[];
  /** `text->text`, `text+image->text`. Empty when the listing does not say. */
  modality: string;
}

/** Number, from whatever the vendor put there — often a string, sometimes null. */
const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A vendor's model listing, as a sorted, de-duplicated `ModelInfo[]`.
 *
 * Tolerant on purpose. The three shapes seen in the wild are OpenRouter's
 * (rich: pricing, context, `supported_parameters`), OpenAI's (`id` and
 * `owned_by`), and Groq's (`context_window` rather than `context_length`).
 * Anything unrecognised contributes an id and blanks, and a payload that is not
 * a list at all produces an empty array rather than throwing — this is called
 * on a response from a URL the owner typed, and "that did not look like a model
 * list" is a message, not a stack trace.
 *
 * Prices are normalised to **USD per million tokens** because that is the unit
 * every vendor quotes in prose and none of them return; OpenRouter's
 * `pricing.prompt` is dollars per token, which renders as `0.0000001` in a
 * table nobody can read.
 */
export function normaliseModels(payload: unknown): ModelInfo[] {
  const source = payload as { data?: unknown[]; models?: unknown[] } | null;
  const rows = Array.isArray(source?.data)
    ? source.data
    : Array.isArray(source?.models)
      ? source.models
      : [];

  const seen = new Set<string>();
  const models: ModelInfo[] = [];

  for (const raw of rows) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const id = str(row.id) || str(row.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const pricing = (row.pricing ?? {}) as Record<string, unknown>;
    const architecture = (row.architecture ?? {}) as Record<string, unknown>;

    const perToken = (value: unknown): number | null => {
      const n = num(value);
      return n === null ? null : n * 1_000_000;
    };

    const promptPrice = perToken(pricing.prompt);
    const completionPrice = perToken(pricing.completion);

    models.push({
      id,
      name: str(row.name) || id,
      description: str(row.description).slice(0, 400),
      contextLength: num(row.context_length) ?? num(row.context_window) ?? num(row.max_context_length),
      promptPrice,
      completionPrice,
      /* Two ways to be free and both are common: a zero price, and OpenRouter's
         `:free` suffix on a variant that has no pricing block at all. */
      free: id.endsWith(':free') || (promptPrice === 0 && completionPrice === 0),
      supported: Array.isArray(row.supported_parameters)
        ? row.supported_parameters.filter((p): p is string => typeof p === 'string')
        : [],
      modality: str(architecture.modality) || str(row.modality),
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------- sampling parameters ---------- */

/**
 * A knob the admin may turn, and the range it may be turned within.
 *
 * `fallback` is what the vendor does when the field is absent, and is shown as
 * the placeholder rather than pre-filled: an unset parameter is *not sent at
 * all*, which is different from being sent at its default. Several providers
 * reject `top_k` outright, and a form that helpfully filled it in with 40 would
 * turn every one of those into a 400 that reads as a bad key.
 *
 * `max_tokens` is deliberately absent. It is this site's spending ceiling, set
 * per task and clamped by `clampSettings()`, and a parameter map that could
 * carry it would be a settings form quietly lifting its own limit.
 */
export interface ParamSpec {
  /** The request body field, verbatim. */
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** What the API does when it is not sent. */
  fallback: string;
  hint: string;
}

export const PARAM_SPECS: ParamSpec[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0,
    max: 2,
    step: 0.05,
    fallback: 'per task',
    hint: 'Randomness. Set here, it overrides the value each writing task asks for.',
  },
  {
    key: 'top_p',
    label: 'Top P',
    min: 0,
    max: 1,
    step: 0.01,
    fallback: '1',
    hint: 'Nucleus sampling. Lower keeps the model to its likelier words.',
  },
  {
    key: 'top_k',
    label: 'Top K',
    min: 0,
    max: 200,
    step: 1,
    fallback: 'off',
    hint: 'Only the K likeliest tokens. Not accepted by OpenAI.',
  },
  {
    key: 'frequency_penalty',
    label: 'Frequency penalty',
    min: -2,
    max: 2,
    step: 0.05,
    fallback: '0',
    hint: 'Discourages repeating the same words.',
  },
  {
    key: 'presence_penalty',
    label: 'Presence penalty',
    min: -2,
    max: 2,
    step: 0.05,
    fallback: '0',
    hint: 'Discourages returning to the same subjects.',
  },
  {
    key: 'repetition_penalty',
    label: 'Repetition penalty',
    min: 0,
    max: 2,
    step: 0.05,
    fallback: '1',
    hint: 'The open-weight equivalent of the two above.',
  },
  {
    key: 'min_p',
    label: 'Min P',
    min: 0,
    max: 1,
    step: 0.01,
    fallback: '0',
    hint: 'Floor on a token’s probability, relative to the likeliest one.',
  },
  {
    key: 'top_a',
    label: 'Top A',
    min: 0,
    max: 1,
    step: 0.01,
    fallback: '0',
    hint: 'OpenRouter’s adaptive variant of Top P.',
  },
  {
    key: 'seed',
    label: 'Seed',
    min: 0,
    max: 2_147_483_647,
    step: 1,
    fallback: 'random',
    hint: 'Same seed, same prompt, same answer — where the vendor supports it.',
  },
];

const PARAM_BY_KEY = new Map(PARAM_SPECS.map(spec => [spec.key, spec]));

/**
 * The sampling parameters a request may carry, from whatever was stored.
 *
 * The allowlist this module exists for. Keys come from `PARAM_SPECS`; a key
 * that is not in it is dropped, so nothing in the database and nothing typed
 * into the form can add a field to the outbound body. Values are coerced,
 * clamped to the spec's range, and a non-finite one is dropped rather than sent
 * as `NaN` — which serialises to `null` and is a 400 at most vendors.
 *
 * An empty result is the normal case and means "send no sampling fields".
 */
export function clampParams(raw: unknown): Record<string, number> {
  let source: unknown = raw;
  if (typeof source === 'string') {
    if (!source.trim()) return {};
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const spec = PARAM_BY_KEY.get(key);
    if (!spec) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    const clamped = Math.min(Math.max(n, spec.min), spec.max);
    out[key] = spec.step >= 1 ? Math.round(clamped) : clamped;
  }
  return out;
}
