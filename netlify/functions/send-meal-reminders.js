// SCHEDULED (see netlify.toml [functions.send-meal-reminders]).
// Sends a real push notification to every real subscribed browser,
// prompting a photo log. Requires VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY set as Netlify env vars — without them this
// exits cleanly and logs why, it does not error the whole
// scheduled run or send anything fake.
//
// Known real limitation, not silently ignored: this fires on a
// single fixed UTC schedule (see netlify.toml), not per-person
// local time. Subscriptions aren't tied to a timezone yet. Until
// that's added, whoever's timezone this lands badly for will get
// a reminder at an odd local hour. Worth fixing before this goes
// wide, not something to quietly ship around.

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const MEAL_REMINDER_MESSAGES = [
  'Eating something? Snap a quick photo — a few seconds, no typing.',
  'Real quick — got a photo of your last meal for Basil?',
  'Keep the streak going — snap a photo of what you\u2019re eating.',
];

exports.handler = async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.log('send-meal-reminders: VAPID keys not configured yet, skipping this run.');
    return { statusCode: 200, body: 'Skipped — VAPID keys not set.' };
  }

  webpush.setVapidDetails('mailto:support@mydrsage.app', publicKey, privateKey);

  let subscriptions = [];
  try {
    const supabase = createClient(process.env.SAGE_SUPABASE_URL, process.env.SAGE_SUPABASE_ANON);
    const { data, error } = await supabase.from('push_subscriptions').select('*').eq('reminder_type', 'meal_reminder');
    if (error) throw error;
    subscriptions = data || [];
  } catch (e) {
    console.log('send-meal-reminders: could not load subscriptions:', e.message);
    return { statusCode: 500, body: e.message };
  }

  if (!subscriptions.length) {
    console.log('send-meal-reminders: no real subscriptions yet.');
    return { statusCode: 200, body: 'No subscriptions.' };
  }

  const message = MEAL_REMINDER_MESSAGES[Math.floor(Math.random() * MEAL_REMINDER_MESSAGES.length)];
  const payload = JSON.stringify({ title: 'myDrSage', body: message, url: '/scores.html' });

  let sent = 0, failed = 0;
  const supabase = createClient(process.env.SAGE_SUPABASE_URL, process.env.SAGE_SUPABASE_ANON);
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (e) {
      failed++;
      // 410/404 means the browser unsubscribed or the endpoint is
      // dead — real cleanup, not a guess, only for confirmed-gone
      // subscriptions.
      if (e.statusCode === 410 || e.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
    }
  }

  console.log(`send-meal-reminders: sent ${sent}, failed ${failed}, of ${subscriptions.length} real subscriptions.`);
  return { statusCode: 200, body: `Sent ${sent}, failed ${failed}.` };
};
