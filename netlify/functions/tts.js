/* ─────────────────────────────────────────────────────
   ElevenLabs TTS proxy
   POST { text, voiceId? }
   Returns audio/mpeg stream
   ───────────────────────────────────────────────────── */

// Best voices for a warm clinical female physician tone:
// Rachel  — calm, warm, clear:       21m00Tc8r5r5hJfvQ5ar  (free tier)
// Aria    — natural conversational:  9BWtsMINqrJLrRacOk9x
// Sarah   — soft, trustworthy:       EXAVITQu4vr4xnSDxMaL
// Lily    — warm British:            pFZP5JQG7iQjIQuC4Bku

const DEFAULT_VOICE = '21m00Tc8r5r5hJfvQ5ar'; // Rachel

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set in Netlify environment variables' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { text, voiceId } = body;
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'No text provided' }) };

  const voice = voiceId || DEFAULT_VOICE;

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2',   // fastest, lowest latency
          voice_settings: {
            stability: 0.55,             // balanced — not robotic, not erratic
            similarity_boost: 0.80,      // stays in character
            style: 0.15,                 // slight warmth
            use_speaker_boost: true
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `ElevenLabs error: ${err}` })
      };
    }

    // Return audio as base64 so it survives Netlify's response pipeline
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ audio: base64 })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
