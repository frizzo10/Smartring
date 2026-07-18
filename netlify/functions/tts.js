/* ─────────────────────────────────────────────────────
   myDrSage — Azure Speech (TTS) proxy
   Extends the original single-voice version (Jenny-only,
   empathetic style, direct binary stream for Safari
   compatibility) to support 5 real personas. The direct-binary
   response pattern is preserved deliberately — the original's
   own comment flagged it as solving a real Safari/WebKit issue
   with data-URI audio, not a style preference, so it stays.

   Requires two Netlify environment variables (already set in
   this project, confirmed live alongside ANTHROPIC_API_KEY):
     AZURE_SPEECH_KEY
     AZURE_SPEECH_REGION
   ───────────────────────────────────────────────────── */

// Same 5 voices as scores.js's VOICE_MAP — duplicated
// intentionally, server-side must never trust a client-supplied
// voice name. All 5 are confirmed on Azure's emotion-style-capable
// voice list (Aria, Davis, Guy, Jenny, Sara among them).
const VOICE_MAP = {
  drSage: 'en-US-DavisNeural',
  sleep: 'en-US-JennyNeural',
  stress: 'en-US-SaraNeural',
  activity: 'en-US-GuyNeural',
  nutrition: 'en-US-AriaNeural',
};

// "empathetic" was proven working specifically on Jenny in the
// original version — not applied to the other 4 voices since
// their style support isn't independently confirmed, and Azure
// can reject a style a voice doesn't actually support. Safer to
// under-claim here than risk a synthesis failure on an unverified
// style/voice combination.
const CONFIRMED_STYLES = { sleep: 'empathetic' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const text = body.text;
  if (!text) return { statusCode: 400, body: 'No text' };

  const voiceKey = body.voiceKey;
  const voiceName = VOICE_MAP[voiceKey];
  if (!voiceName) return { statusCode: 400, body: `Unknown voiceKey "${voiceKey}"` };

  const azureKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastus';

  const clean = text.replace(/<[^>]*>/g, '').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const style = CONFIRMED_STYLES[voiceKey];
  const inner = `<prosody rate="-8%" pitch="-2%">${clean}</prosody>`;
  const voiceInner = style
    ? `<mstts:express-as style="${style}">${inner}</mstts:express-as>`
    : inner;

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="${voiceName}">${voiceInner}</voice>
  </speak>`;

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'myDrSage',
      },
      body: ssml,
    }
  );

  if (!res.ok) {
    const err = await res.text();
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

