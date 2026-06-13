/* ─────────────────────────────────────────────────────
   SageHealth AI proxy — Groq (everything)
   Groq free tier: 14,400 req/day
   Model: llama-3.3-70b-versatile
   ~10x cheaper, ~5x faster than Claude Sonnet
   ───────────────────────────────────────────────────── */

const GROQ_MODEL = 'llama-3.3-70b-versatile';

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

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: body.max_tokens || 1000,
        temperature: 0.7,
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
      model: GROQ_MODEL,
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
