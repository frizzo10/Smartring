/* ─────────────────────────────────────────────────────
   Azure Cognitive Services TTS proxy
   POST { text, voice? }
   Returns audio/mpeg as base64
   Free tier: 500k characters/month forever (F0)
   ───────────────────────────────────────────────────── */

// Best Azure neural voices for Dr. Sage:
// en-US-AriaNeural      — warm, conversational, natural  <- default
// en-US-JennyNeural     — friendly, clear, trustworthy
// en-US-SaraNeural      — calm, professional
// en-US-NancyNeural     — warm, empathetic
// en-GB-SoniaNeural     — British, authoritative

const DEFAULT_VOICE = 'en-US-AriaNeural';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'AZURE_SPEECH_KEY not set in Netlify environment variables' })
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { text, voice } = body;
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'No text provided' }) };

  const selectedVoice = voice || DEFAULT_VOICE;

  // SSML gives us control over rate, pitch, and emotional style
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="http://www.w3.org/2001/mstts"
    xml:lang="en-US">
    <voice name="${selectedVoice}">
      <mstts:express-as style="empathetic">
        <prosody rate="-8%" pitch="-2%">
          ${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
        </prosody>
      </mstts:express-as>
    </voice>
  </speak>`;

  try {
    const response = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'SageHealth'
        },
        body: ssml
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Azure TTS error ${response.status}: ${err}` })
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ audio: base64 })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
