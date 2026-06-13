/* ─────────────────────────────────────────────────────
   SageHealth — Claude Vision document analysis
   Reads lab reports, blood panels, doctor notes,
   ECGs, radiology summaries — anything medical.
   ───────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'No API key' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { base64, mediaType, fileName } = body;
  if (!base64) return { statusCode: 400, body: JSON.stringify({ error: 'No file data' }) };

  const systemPrompt = `You are a medical document analyzer for SageHealth, a health monitoring app. 
Analyze the provided medical document and extract structured data.
Return ONLY valid JSON — no other text, no markdown.

Required JSON structure:
{
  "document_type": "lab_result|doctor_note|ecg|imaging|prescription|other",
  "document_date": "YYYY-MM-DD or null",
  "provider": "doctor/lab name or null",
  "summary": "2-3 sentence plain English summary of the document",
  "key_findings": [
    { "marker": "test name", "value": "result value", "unit": "unit", "reference_range": "normal range", "status": "normal|high|low|critical", "clinical_note": "plain English explanation" }
  ],
  "diagnoses_mentioned": ["list of any diagnoses mentioned"],
  "medications_mentioned": ["list of any medications mentioned"],
  "follow_up_required": true|false,
  "follow_up_notes": "what follow-up was recommended",
  "doctor_recommendations": "what the physician recommended",
  "flags": ["any values that need attention"],
  "patient_friendly_summary": "What this means in plain English for a non-medical person — 2-3 sentences"
}`;

  try {
    // Use Claude claude-haiku-4-5-20251001 for vision — fast and accurate for documents
    const contentBlock = mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: `Analyze this medical document (filename: ${fileName || 'document'}). Extract all structured data and return as JSON only.` }
          ]
        }]
      })
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch(e) { parsed = { error: 'Could not parse analysis', raw: text.slice(0, 500) }; }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
