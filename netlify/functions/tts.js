/* ─────────────────────────────────────────────────────
   SageHealth TTS — returns audio/mpeg directly
   Safari compatible — no base64, direct stream
   ───────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const text = body.text;
  if (!text) return { statusCode: 400, body: 'No text' };

  const azureKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastus';

  const clean = text.replace(/<[^>]*>/g, '').trim()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="en-US-JennyNeural">
      <mstts:express-as style="empathetic">
        <prosody rate="-8%" pitch="-2%">${clean}</prosody>
      </mstts:express-as>
    </voice>
  </speak>`;

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'SageHealth'
      },
      body: ssml
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
      'Access-Control-Allow-Origin': '*'
    },
    body: Buffer.from(buffer).toString('base64'),
    isBase64Encoded: true
  };
};
