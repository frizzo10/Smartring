/* Receives a ring data snapshot from dashboard.js after a successful
   connect (or HRV compute) and writes it to Supabase as a permanent,
   timestamped row — the ring's own memory and the browser cache both
   only hold the most recent data; this is what gives us real history.

   Fixed device_id, no auth system exists yet — see
   supabase_ring_snapshots.sql for the plan to add real auth later. */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const supabase = createClient(
      process.env.SAGE_SUPABASE_URL,
      process.env.SAGE_SUPABASE_ANON
    );

    const snapshot = JSON.parse(event.body || '{}');

    const { error } = await supabase.from('sage_ring_snapshots').insert({
      device_id: 'frank-colmi-r02',
      snapshot,
    });

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('ring-sync error', e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
