/* ─────────────────────────────────────────────────────
   myDrSage — Azure Speech (TTS) proxy
   Multi-voice version. Preserves the direct-binary-stream
   response pattern from the prior single-voice version of this
   file (explicitly noted there as the Safari-compatible fix —
   no JSON+base64 wrapper, no data: URI on the client, just a
   normal binary HTTP response the browser's fetch().blob() can
   consume directly). Voice selection is a request-side concern
   (voiceKey in the POST body) and is fully independent of that
   response format, so there was no real tradeoff between the two
   — multi-voice support doesn't require giving up the safer
   response pattern, and shouldn't.

   Requires two Netlify environment variables (already present in
   this project, confirmed live alongside ANTHROPIC_API_KEY):
     AZURE_SPEECH_KEY
     AZURE_SPEECH_REGION
   ───────────────────────────────────────────────────── */

const VOICE_MAP = {
  drSage: 'en-US-DavisNeural',
  sleep: 'en-US-JennyNeural',
  stress: 'en-US-SaraNeural',
  activity: 'en-US-GuyNeural',
  nutrition: 'en-US-AriaNeural',
};

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

exports.handler = async (event) => {
  // Real CORS preflight handling — needed because this is now
  // called cross-origin from the marketing site too, and a JSON
  // POST triggers a real browser preflight OPTIONS request first.
  // Without this, the browser blocks the actual request before it
  // ever reaches the code below, even though the final response
  // already had Access-Control-Allow-Origin set.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const text = (body.text || '').replace(/<[^>]*>/g, '').trim();
  if (!text) return { statusCode: 400, body: 'No text' };

  const voiceName = VOICE_MAP[body.voiceKey];
  if (!voiceName) return { statusCode: 400, body: `Unknown voiceKey "${body.voiceKey}"` };

  const azureKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastus';
  if (!azureKey) return { statusCode: 500, body: 'AZURE_SPEECH_KEY not set in Netlify environment variables' };

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voiceName}">${escapeXml(text)}</voice></speak>`;

  let res;
  try {
    res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'myDrSage',
      },
      body: ssml,
    });
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    return { statusCode: res.status, body: err };
  }

  const buffer = await res.arrayBuffer();
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.byteLength.toString(),
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
    body: Buffer.from(buffer).toString('base64'),
    isBase64Encoded: true,
  };
};
