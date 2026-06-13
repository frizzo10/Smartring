/* ─────────────────────────────────────────────────────
   SageHealth TTS proxy — Azure Aria Neural
   Free tier: 500k characters/month forever
   Upgrade path: swap in ElevenLabs when on paid plan
   ───────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { text } = body;
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'No text provided' }) }; 

  const clean = text.replace(/<[^>]*>/g, '').trim();

  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (!azureKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AZURE_SPEECH_KEY not set', engine: 'none' }) };
  }

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="en-US-AriaNeural">
      <mstts:express-as style="empathetic">
        <prosody rate="-8%" pitch="-2%">
          ${clean.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
        </prosody>
      </mstts:express-as>
    </voice>
  </speak>`;

  try {
    const res = await fetch(
      `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
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

    if (res.ok) {
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, engine: 'azure-aria' })
      };
    }

    const errText = await res.text();
    return { statusCode: res.status, body: JSON.stringify({ error: errText, engine: 'none' }) };

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, engine: 'none' }) };
  }
};
