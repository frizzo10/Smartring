/* Quick TTS test — call this directly to verify Azure returns audio */
exports.handler = async (event) => {
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (!azureKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No Azure key' }) };
  }

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="en-US-JennyNeural">
      <mstts:express-as style="empathetic">
        <prosody rate="-8%" pitch="-2%">
          Hi Frank. This is Dr. Sage. If you can hear this, the voice system is working correctly.
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

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: err }) };
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    // Return an HTML page that plays the audio directly
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>TTS Test</title></head>
<body style="font-family:sans-serif;padding:40px;text-align:center;">
  <h2>🧠 Dr. Sage Voice Test</h2>
  <p>Azure Jenny Neural — tap play to hear</p>
  <audio controls autoplay style="width:100%;margin:20px 0;">
    <source src="data:audio/mpeg;base64,${base64}" type="audio/mpeg">
  </audio>
  <p style="color:green;font-weight:bold;">✓ Azure TTS is working (${buffer.byteLength} bytes)</p>
</body>
</html>`
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
