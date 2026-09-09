/**
 * Headroom compression in front of the model — optional, and off unless
 * configured.
 *
 * "Headroom" here is headroomlabs-ai/headroom, the context-compression proxy
 * (`npm:headroom-ai`, TypeScript SDK), not `THINKING_HEADROOM` in `ai.ts` —
 * the two share a word and nothing else. The proxy shrinks the *input* side
 * (indexes, READMEs, transcripts, tool results) before it reaches the vendor,
 * which is what frees tokens inside the same `max_tokens` ceiling for the
 * thinking *and* the answer. It does not raise ceilings and does not change
 * the thinking/answer split — `reasoningEffort` and `effectiveMaxTokens()`
 * still own those. What it buys is fewer input tokens billed per call and a
 * prompt with less room to crowd the answer out.
 *
 * ## Why it is a no-op by default
 *
 * The TypeScript SDK is an HTTP client: `compress()` POSTs to a Headroom
 * proxy's `/v1/compress`, which must be reachable from the Worker. There is
 * no such proxy in production unless the owner runs one — locally with
 * `headroom proxy --port 8787` for dev, or self-hosted with
 * `HEADROOM_COMPRESS_ALLOW_REMOTE=1` for deploys — and points this site at it
 * with the `HEADROOM_BASE_URL` var. Unset (or blank) means this module returns
 * its input untouched and makes no request at all, so a site that never heard
 * of Headroom behaves exactly as before. `wrangler dev` reads it from
 * `.dev.vars`; production from `wrangler vars` / dashboard vars.
 *
 * When a proxy *is* configured, failure still degrades to uncompressed:
 * `fallback: true` returns the original messages on connection errors and 5xx
 * rather than throwing, and the `try/catch` below covers the rest (auth and
 * 400s always throw). A compression fault must never become an answer fault.
 *
 * Server-only. The type import is erased at compile time.
 */

import { compress } from 'headroom-ai';
import type { ChatMessage } from './ai';

export interface HeadroomStats {
  /** Whether a proxy was configured at all. */
  enabled: boolean;
  /** Whether the proxy actually compressed (false on fallback). */
  compressed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  transformsApplied: string[];
  /** Present when the input went through unchanged for a known reason. */
  note?: string;
}

/**
 * Whether a compressed transcript is still the same conversation, structurally.
 *
 * The proxy may drop, merge or reorder turns (rolling windows do exactly
 * that), and any of those corrupt a tool loop: an assistant turn carrying
 * `tool_calls` without its `tool` answers — or answers without their call —
 * is a 400 from the vendor, not a shorter prompt. Content may shrink; the
 * roles in order and every tool-call linkage must not. Arguments are compared
 * by identity of call (`id:name`), not by bytes — re-serialised JSON is still
 * the same call.
 */
export function sameToolLinkage(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  const shape = (m: ChatMessage): string =>
    [
      m.role,
      m.tool_call_id ?? '',
      ...(m.tool_calls?.map(call => `${call.id}:${call.function.name}`) ?? []),
    ].join('|');
  return a.every((msg, i) => shape(msg) === shape(b[i]));
}

const DISABLED: HeadroomStats = {
  enabled: false,
  compressed: false,
  tokensBefore: 0,
  tokensAfter: 0,
  tokensSaved: 0,
  transformsApplied: [],
};

/**
 * Compress one call's messages through the configured Headroom proxy.
 *
 * `model` is for the proxy's token counting only — it never selects what
 * answers. Pass the model most likely to answer (the caller's pick, else the
 * provider row's), falling back to any stable id when nothing is configured.
 */
export async function compressForModel(
  messages: ChatMessage[],
  options: { model?: string; baseUrl?: string | null; timeoutMs?: number },
): Promise<{ messages: ChatMessage[]; stats: HeadroomStats }> {
  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) return { messages, stats: DISABLED };

  /* The proxy does not know this repo's `cache` flag — the stable-prefix
     marker `wireMessages()` in `ai.ts` turns into a breakpoint for the two
     APIs that read one. Remember it and put it back on the way out, so a
     compressed call caches its prefix exactly like an uncompressed one. */
  const cacheFirst = messages[0]?.role === 'system' && messages[0].cache === true;

  try {
    const result = await compress(messages, {
      model: options.model?.trim() || 'gpt-4o',
      baseUrl,
      timeout: options.timeoutMs ?? 5000,
      fallback: true,
      /* One retry: the proxy occasionally misses under concurrent rounds and
         answers the second attempt fine. Past that, the answer goes out
         uncompressed rather than late. */
      retries: 2,
    });

    let out = (result.messages ?? messages) as ChatMessage[];
    if (cacheFirst && out[0]?.role === 'system') out = [{ ...out[0], cache: true }, ...out.slice(1)];

    return {
      messages: out,
      stats: {
        enabled: true,
        compressed: result.compressed === true,
        tokensBefore: result.tokensBefore ?? 0,
        tokensAfter: result.tokensAfter ?? 0,
        tokensSaved: result.tokensSaved ?? 0,
        transformsApplied: result.transformsApplied ?? [],
        ...(result.compressed === true
          ? {}
          : { note: 'proxy returned the input unchanged (fallback)' }),
      },
    };
  } catch (error) {
    /* Auth errors and bad requests always throw, even with `fallback: true`.
       Either way the answer must still go out — on the original messages. */
    return {
      messages,
      stats: {
        ...DISABLED,
        enabled: true,
        note: error instanceof Error ? error.message.slice(0, 200) : 'headroom compress failed',
      },
    };
  }
}
