// Real food photo per dish, via the Pexels Search API \u2014 not a
// generated image, an actual photo matching the dish name. Needs
// PEXELS_API_KEY set as a Netlify env var (free tier, sign up at
// pexels.com/api). Returns a real, honest 503 if the key isn't
// configured yet, never a placeholder image pretending to be real.

exports.handler = async (event) => {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Recipe images are not configured yet.' }) };
  }

  const query = (event.queryStringParameters && event.queryStringParameters.query || '').trim();
  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing query' }) };
  }

  try {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=square`, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) throw new Error(`Pexels request failed: ${res.status}`);
    const data = await res.json();
    const photo = data.photos && data.photos[0];
    if (!photo) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No real photo found for that dish' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'public, max-age=604800' }, // real photo for a real dish name doesn't change, safe to cache a week
      body: JSON.stringify({ url: photo.src.medium, photographer: photo.photographer }),
    };
  } catch (e) {
    console.log('get-recipe-image failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
