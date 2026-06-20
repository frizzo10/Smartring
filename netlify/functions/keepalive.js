/* Runs on a schedule to keep Supabase from pausing the free tier project */
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  try {
    const supabase = createClient(
      process.env.SAGE_SUPABASE_URL,
      process.env.SAGE_SUPABASE_ANON
    );
    // Lightweight ping — just count rows in a small table
    await supabase.from('sage_profiles').select('id', { count: 'exact', head: true });
    console.log('Supabase keepalive ping OK', new Date().toISOString());
    return { statusCode: 200, body: 'OK' };
  } catch(e) {
    console.log('Keepalive failed:', e.message);
    return { statusCode: 500, body: e.message };
  }
};
