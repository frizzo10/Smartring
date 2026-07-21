/* ─────────────────────────────────────────────────────
   SageHealth AI proxy — Groq (everything)
   Groq free tier: 14,400 req/day
   Model: openai/gpt-oss-20b (switched from qwen/qwen3.6-27b
   2026-07-21 — production tier on Groq, not preview; ~900-1200
   tok/s vs qwen's much slower throughput; $0.10/$0.50 per 1M vs
   qwen's $0.60/$3.00. reasoning_effort set to 'low', NOT qwen's
   'none' -- gpt-oss models use low/medium/high, not none/some;
   'none' may not be valid for this family and risked reproducing
   the same reasoning-field-leak that caused the earlier
   gpt-oss-120b attempt to get reverted. NEEDS REAL VERIFICATION
   in the live app that reasoning content isn't leaking into
   responses before this is trusted the way qwen was.
   ───────────────────────────────────────────────────── */

const GROQ_MODEL = 'openai/gpt-oss-20b';
// gpt-oss-20b has NO vision support at all (confirmed: OpenAI's
// gpt-oss family is text-only). The two real callers that send
// images -- photo-based nutrition logging and the coin-reference
// finger-sizing feature -- must explicitly override to qwen,
// which is the only vision-capable model available on Groq here.
// Silently routing an image-containing request through a
// text-only model doesn't necessarily error -- it can just
// ignore the image and fabricate a plausible-sounding answer with
// no actual visual basis, which is worse than a loud failure.
const VISION_MODEL = 'qwen/qwen3.6-27b';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GROQ_API_KEY not set in Netlify environment variables' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Build messages array — Groq uses OpenAI format
  // If system prompt provided, prepend as system message
  const messages = [];
  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }
  if (body.messages) {
    messages.push(...body.messages);
  }

  // Auto-detect image content rather than trusting every caller to
  // remember a flag -- scans the actual messages being sent, so
  // this can't silently drift out of sync with what callers
  // actually do.
  const containsImage = messages.some(m =>
    Array.isArray(m.content) && m.content.some(part => part && part.type === 'image_url')
  );
  const modelForThisCall = containsImage ? VISION_MODEL : GROQ_MODEL;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelForThisCall,
        max_tokens: body.max_tokens || 1000,
        temperature: 0.7,
        reasoning_effort: containsImage ? 'none' : 'low', // qwen (vision) uses 'none'; gpt-oss (text) uses low/medium/high
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || 'Groq API error' })
      };
    }

    // Return in Anthropic format so the frontend code doesn't need to change
    const text = data.choices?.[0]?.message?.content || '';
    const anthropicFormat = {
      content: [{ type: 'text', text }],
      model: modelForThisCall,
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0
      }
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(anthropicFormat)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
