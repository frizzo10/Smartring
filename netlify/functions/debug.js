/* Debug — check which API keys are loaded */
exports.handler = async (event) => {
  const eleven = process.env.ELEVENLABS_API_KEY;
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const groq = process.env.GROQ_API_KEY;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elevenlabs: eleven ? `present (${eleven.length} chars, starts: ${eleven.slice(0,6)}...)` : 'MISSING',
      azure: azureKey ? `present (${azureKey.length} chars)` : 'MISSING',
      groq: groq ? `present (${groq.length} chars)` : 'MISSING',
      node_version: process.version
    })
  };
};
