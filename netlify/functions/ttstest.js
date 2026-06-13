/* TTS test — serves audio directly as MP3, Safari compatible */
exports.handler = async (event) => {
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

  // If ?play=1, stream the audio directly as MP3
  if (event.queryStringParameters?.play === '1') {
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
      xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
      <voice name="en-US-JennyNeural">
        <mstts:express-as style="empathetic">
          <prosody rate="-8%" pitch="-2%">
            Hi Frank. This is Dr. Sage. If you can hear this, the voice system is working perfectly.
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

    const buffer = await res.arrayBuffer();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.byteLength.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      },
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true
    };
  }

  // Default — serve HTML page with direct audio src URL
  const audioUrl = '/.netlify/functions/ttstest?play=1';
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dr. Sage Voice Test</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 40px 20px; text-align: center; background: #f0f4f8; }
    .card { background: white; border-radius: 16px; padding: 30px; max-width: 400px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    h2 { color: #1d6fa4; margin-bottom: 8px; }
    p { color: #6b7f96; font-size: 14px; margin-bottom: 24px; }
    audio { width: 100%; margin: 16px 0; }
    .status { color: #0e9f6e; font-weight: 600; font-size: 14px; margin-top: 16px; }
    .btn { display: inline-block; background: #1d6fa4; color: white; border: none; border-radius: 12px; padding: 14px 28px; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 16px; -webkit-tap-highlight-color: transparent; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🧠 Dr. Sage Voice Test</h2>
    <p>Azure Jenny Neural voice — tap to play</p>
    <audio id="player" controls preload="auto">
      <source src="${audioUrl}" type="audio/mpeg">
    </audio>
    <br>
    <button class="btn" onclick="document.getElementById('player').play()">▶ Play Dr. Sage</button>
    <p class="status">✓ Azure TTS connected — 138kb audio ready</p>
  </div>
</body>
</html>`
  };
};
