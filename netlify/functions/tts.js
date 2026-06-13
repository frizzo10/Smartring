/* ─────────────────────────────────────────────────────
   SageHealth TTS proxy
   Primary:  ElevenLabs Rachel (21m00Tc8r5r5hJfvQ5ar)
   Fallback: Azure Aria Neural
   ───────────────────────────────────────────────────── */

const ELEVEN_VOICE_ID = '21m00Tc8r5r5hJfvQ5ar'; // Rachel

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

  // ── Try ElevenLabs first ──────────────────────────────
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (elevenKey) {
    try {
      console.log('Trying ElevenLabs, key starts:', elevenKey.slice(0,6));
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': elevenKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
          },
          body: JSON.stringify({
            text: clean,
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.55,
              similarity_boost: 0.80,
              style: 0.15,
              use_speaker_boost: true
            }
          })
        }
      );

      console.log('ElevenLabs status:', res.status);

      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        console.log('ElevenLabs success, audio bytes:', buffer.byteLength);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, engine: 'elevenlabs-rachel' })
        };
      } else {
        const errText = await res.text();
        console.log('ElevenLabs error response:', errText);
      }
    } catch(e) {
      console.log('ElevenLabs exception:', e.message);
    }
  }

  // ── Fallback: Azure Aria Neural ───────────────────────
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (azureKey) {
    try {
      console.log('Trying Azure TTS');
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

      console.log('Azure status:', res.status);

      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, engine: 'azure-aria' })
        };
      } else {
        const errText = await res.text();
        console.log('Azure error:', errText);
      }
    } catch(e) {
      console.log('Azure exception:', e.message);
    }
  }

  return {
    statusCode: 503,
    body: JSON.stringify({ error: 'No TTS service available', engine: 'none' })
  };
};
