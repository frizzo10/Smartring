// Stores a real browser push subscription so send-meal-reminders.js
// (scheduled) has something real to send to later. Upserts on
// endpoint so re-subscribing never creates a duplicate row.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { subscription, reminderType } = body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or malformed subscription' }) };
  }

  try {
    const supabase = createClient(process.env.SAGE_SUPABASE_URL, process.env.SAGE_SUPABASE_ANON);
    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      reminder_type: reminderType || 'meal_reminder',
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.log('save-push-subscription failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
