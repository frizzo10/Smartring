/* ═══════════════════════════════════════════════════
   SAGEHEALTH — SUPABASE SYNC & MEMORY ENGINE

   Handles:
   - Auth (sign up / sign in)
   - Dr. Sage persistent memory
   - Conversation storage
   - Commitment sync
   - Document upload + Claude Vision
   - Test result storage
   - Cross-device sync
   ═══════════════════════════════════════════════════ */

const SUPABASE_URL  = window.SAGE_SUPABASE_URL  || '';
const SUPABASE_ANON = window.SAGE_SUPABASE_ANON || '';

/* ── SUPABASE CLIENT (lightweight, no SDK needed) ── */
const SB = {
  url: SUPABASE_URL,
  key: SUPABASE_ANON,
  userId: null,

  headers() {
    const h = {
      'Content-Type': 'application/json',
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`
    };
    const session = this.getSession();
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
    return h;
  },

  async request(method, path, body) {
    if (!this.url) return null;
    try {
      const res = await fetch(`${this.url}/rest/v1/${path}`, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        const err = await res.text();
        console.log(`SB ${method} ${path} error:`, err);
        return null;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch(e) {
      console.log('SB request failed:', e.message);
      return null;
    }
  },

  // Auth
  async signUp(email, password, name) {
    const res = await fetch(`${this.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': this.key },
      body: JSON.stringify({ email, password, data: { name } })
    });
    const data = await res.json();
    if (data.access_token) this.saveSession(data);
    return data;
  },

  async signIn(email, password) {
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': this.key },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.access_token) { this.saveSession(data); this.userId = data.user?.id; }
    return data;
  },

  async signOut() {
    await fetch(`${this.url}/auth/v1/logout`, {
      method: 'POST', headers: this.headers()
    });
    localStorage.removeItem('sage_session');
    this.userId = null;
  },

  saveSession(data) {
    localStorage.setItem('sage_session', JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
      user: data.user
    }));
    this.userId = data.user?.id;
  },

  getSession() {
    try { return JSON.parse(localStorage.getItem('sage_session')); }
    catch(e) { return null; }
  },

  isAuthenticated() {
    const s = this.getSession();
    return s && s.access_token && s.expires_at > Date.now();
  },

  getCurrentUser() {
    return this.getSession()?.user || null;
  },

  // Storage upload
  async uploadFile(bucket, path, blob, contentType) {
    if (!this.url) return null;
    try {
      const res = await fetch(`${this.url}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: { 'apikey': this.key, 'Authorization': `Bearer ${this.getSession()?.access_token}`, 'Content-Type': contentType },
        body: blob
      });
      return res.ok ? `${this.url}/storage/v1/object/public/${bucket}/${path}` : null;
    } catch(e) { return null; }
  },

  async select(table, query = '') {
    return this.request('GET', `${table}?${query}`);
  },

  async insert(table, data) {
    return this.request('POST', `${table}`, data);
  },

  async upsert(table, data, onConflict = '') {
    const path = onConflict ? `${table}?on_conflict=${onConflict}` : table;
    return this.request('POST', `${path}`, Array.isArray(data) ? data : [data]);
  },

  async update(table, data, match) {
    const query = Object.entries(match).map(([k,v]) => `${k}=eq.${v}`).join('&');
    return this.request('PATCH', `${table}?${query}`, data);
  },
};

/* ═══════════════════════════════════════════════════
   DR. SAGE MEMORY ENGINE
   ═══════════════════════════════════════════════════ */

const SageMemory = {

  // In-memory cache — loaded from Supabase on init
  _cache: {},

  /* ── LOAD ALL MEMORIES ─────────────────────────── */
  async load() {
    if (!SB.isAuthenticated()) {
      // Fall back to localStorage
      try { this._cache = JSON.parse(localStorage.getItem('sage_memory_local') || '{}'); }
      catch(e) { this._cache = {}; }
      return;
    }

    const rows = await SB.select('sage_memory', `user_id=eq.${SB.userId}&select=key,value,category,source,confidence`);
    if (rows) {
      this._cache = {};
      rows.forEach(r => { this._cache[r.key] = r; });
    }
  },

  /* ── GET A MEMORY ──────────────────────────────── */
  get(key) {
    return this._cache[key]?.value || null;
  },

  /* ── GET ALL IN CATEGORY ───────────────────────── */
  getCategory(category) {
    return Object.values(this._cache)
      .filter(m => m.category === category)
      .map(m => ({ key: m.key, value: m.value }));
  },

  /* ── SET A MEMORY ──────────────────────────────── */
  async set(key, value, category = 'life_context', source = 'conversation') {
    this._cache[key] = { key, value, category, source, confidence: 3 };

    // Persist locally always
    localStorage.setItem('sage_memory_local', JSON.stringify(this._cache));

    // Sync to Supabase if authenticated
    if (SB.isAuthenticated()) {
      await SB.upsert('sage_memory', {
        user_id: SB.userId, key, value, category, source, confidence: 3
      }, 'user_id,key');
    }
  },

  /* ── BUILD MEMORY CONTEXT FOR DR. SAGE ─────────── */
  buildContext() {
    const memories = Object.values(this._cache);
    if (!memories.length) return '';

    const sections = {
      life_context:   memories.filter(m => m.category === 'life_context'),
      health_history: memories.filter(m => m.category === 'health_history'),
      preferences:    memories.filter(m => m.category === 'preferences'),
      goals:          memories.filter(m => m.category === 'goals'),
      relationship:   memories.filter(m => m.category === 'relationship'),
    };

    let ctx = 'DR. SAGE PERSISTENT MEMORY (from previous conversations):\n';

    if (sections.life_context.length)
      ctx += `Life context: ${sections.life_context.map(m => m.value).join('. ')}\n`;
    if (sections.health_history.length)
      ctx += `Health history: ${sections.health_history.map(m => m.value).join('. ')}\n`;
    if (sections.goals.length)
      ctx += `Patient goals: ${sections.goals.map(m => m.value).join('. ')}\n`;
    if (sections.preferences.length)
      ctx += `Communication preferences: ${sections.preferences.map(m => m.value).join('. ')}\n`;
    if (sections.relationship.length)
      ctx += `Relationship notes: ${sections.relationship.map(m => m.value).join('. ')}\n`;

    return ctx;
  },

  /* ── EXTRACT MEMORIES FROM CONVERSATION ─────────── */
  async extractFromConversation(messages) {
    if (!messages || messages.length < 2) return;

    const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    try {
      const res = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 400,
          system: `Extract important facts about this person from their conversation with Dr. Sage.
Return ONLY a JSON array of memory objects. No other text.
Each object: { "key": "snake_case_key", "value": "fact as a sentence", "category": "life_context|health_history|preferences|goals|relationship" }

Extract:
- Job/work situation, stress levels
- Family situation, schedule constraints
- What they've tried before (exercise, diet, sleep changes)
- What works and doesn't work for them
- Their goals and motivations
- Barriers they mentioned
- What their doctor has told them
- Medications or conditions they mentioned
- Communication style preferences (do they want detail? direct?)
- Anything Dr. Sage should remember for next time

Return [] if nothing meaningful to extract. Return JSON only.`,
          messages: [{ role: 'user', content: conversation }]
        })
      });

      const d = await res.json();
      const text = d.content?.[0]?.text || '[]';
      const clean = text.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(clean);

      if (Array.isArray(extracted)) {
        for (const mem of extracted) {
          if (mem.key && mem.value && mem.category) {
            await this.set(mem.key, mem.value, mem.category, 'conversation');
          }
        }
        console.log(`Extracted ${extracted.length} memories from conversation`);
      }
    } catch(e) {
      console.log('Memory extraction failed:', e.message);
    }
  },

  /* ── CLEAR ALL ──────────────────────────────────── */
  async clear() {
    this._cache = {};
    localStorage.removeItem('sage_memory_local');
  }
};

/* ═══════════════════════════════════════════════════
   SYNC ENGINE — localStorage → Supabase
   ═══════════════════════════════════════════════════ */

const SageSync = {

  /* ── FULL SYNC ON LOGIN ────────────────────────── */
  async syncAll() {
    if (!SB.isAuthenticated()) return;
    console.log('SageSync: syncing all data...');

    await Promise.all([
      this.syncProfile(),
      this.syncCommitments(),
      this.syncTestResults(),
      SageMemory.load()
    ]);
  },

  /* ── SYNC PROFILE ──────────────────────────────── */
  async syncProfile() {
    if (!SB.isAuthenticated()) return;
    const p = typeof profile !== 'undefined' ? profile : {};
    if (!p.name) return;

    await SB.upsert('sage_profiles', {
      id: SB.userId,
      name: p.name, age: p.age, sex: p.sex,
      weight_lbs: p.weight, conditions: p.conditions || 'None',
      medications: p.medications || 'None'
    }, 'id');
  },

  /* ── SAVE CONVERSATION ─────────────────────────── */
  async saveConversation(sigId, sigTitle, messages, commitment, baselineMetrics) {
    // Extract memories from this conversation
    SageMemory.extractFromConversation(messages);

    if (!SB.isAuthenticated()) return null;

    const result = await SB.insert('sage_conversations', {
      user_id: SB.userId,
      signal_id: sigId,
      signal_title: sigTitle,
      messages,
      commitment: commitment || null,
      baseline_metrics: baselineMetrics || null
    });

    return result?.[0]?.id || null;
  },

  /* ── SAVE COMMITMENT ───────────────────────────── */
  async saveCommitment(commitment, conversationId) {
    // Always save to localStorage
    const local = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
    local.unshift(commitment);
    localStorage.setItem('sh_commitments', JSON.stringify(local));

    if (!SB.isAuthenticated()) return;

    await SB.insert('sage_commitments', {
      user_id: SB.userId,
      signal_id: commitment.sigId,
      signal_title: commitment.sigTitle,
      commitment: commitment.commitment,
      status: 'active',
      baseline_metrics: commitment.baselineMetrics || null,
      conversation_id: conversationId || null
    });
  },

  /* ── SYNC COMMITMENTS ──────────────────────────── */
  async syncCommitments() {
    if (!SB.isAuthenticated()) return;
    const rows = await SB.select('sage_commitments',
      `user_id=eq.${SB.userId}&order=created_at.desc&limit=50`);
    if (rows?.length) {
      localStorage.setItem('sh_commitments', JSON.stringify(rows.map(r => ({
        id: r.id, sigId: r.signal_id, sigTitle: r.signal_title,
        commitment: r.commitment, status: r.status,
        baselineMetrics: r.baseline_metrics, checkIns: r.check_ins || [],
        date: new Date(r.created_at).toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'}),
        dateMs: new Date(r.created_at).getTime()
      }))));
    }
  },

  /* ── SAVE TEST RESULT ──────────────────────────── */
  async saveTestResult(sigId, testType, values, doctorSaid) {
    // localStorage
    const local = JSON.parse(localStorage.getItem('sh_test_results') || '{}');
    local[sigId] = { sigId, testType, values, doctorSaid, date: new Date().toISOString() };
    localStorage.setItem('sh_test_results', JSON.stringify(local));

    // Memory — what did the doctor say?
    if (doctorSaid) {
      await SageMemory.set(
        `doctor_said_${sigId}`,
        `Doctor said about ${sigId}: ${doctorSaid}`,
        'health_history', 'test_result'
      );
    }

    if (!SB.isAuthenticated()) return;
    await SB.insert('sage_test_results', {
      user_id: SB.userId, signal_id: sigId,
      test_type: testType, values, doctor_said: doctorSaid
    });
  },

  /* ── SYNC TEST RESULTS ─────────────────────────── */
  async syncTestResults() {
    if (!SB.isAuthenticated()) return;
    const rows = await SB.select('sage_test_results',
      `user_id=eq.${SB.userId}&order=created_at.desc`);
    if (rows?.length) {
      const local = {};
      rows.forEach(r => { local[r.signal_id] = { ...r, date: r.created_at }; });
      localStorage.setItem('sh_test_results', JSON.stringify(local));
    }
  },

  /* ── UPLOAD DOCUMENT ───────────────────────────── */
  async uploadDocument(file, type, signalIds = []) {
    const userId = SB.userId || 'anonymous';
    const timestamp = Date.now();
    const ext = file.name.split('.').pop();
    const storagePath = `${userId}/${timestamp}.${ext}`;

    let filePath = null;
    if (SB.isAuthenticated()) {
      filePath = await SB.uploadFile('sage-documents', storagePath, file, file.type);
    }

    // Run Claude Vision analysis
    const analysis = await analyzeDocumentWithVision(file);

    // Save to Supabase
    if (SB.isAuthenticated()) {
      await SB.insert('sage_documents', {
        user_id: SB.userId, type, title: file.name,
        file_path: filePath, file_type: ext,
        extracted_data: analysis, signal_ids: signalIds
      });
    }

    // Add key findings to memory
    if (analysis?.key_findings) {
      for (const finding of analysis.key_findings) {
        await SageMemory.set(
          `lab_finding_${finding.marker?.toLowerCase().replace(/\s+/g,'_')}`,
          `Lab result: ${finding.marker} = ${finding.value} (${finding.status})`,
          'health_history', 'test_result'
        );
      }
    }

    return analysis;
  }
};

/* ═══════════════════════════════════════════════════
   CLAUDE VISION — DOCUMENT ANALYSIS
   ═══════════════════════════════════════════════════ */

async function analyzeDocumentWithVision(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      const mediaType = file.type;
      const isImage = mediaType.startsWith('image/');
      const isPDF = mediaType === 'application/pdf';

      if (!isImage && !isPDF) {
        resolve({ error: 'Unsupported file type' });
        return;
      }

      try {
        const res = await fetch('/.netlify/functions/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mediaType, fileName: file.name })
        });
        const data = await res.json();
        resolve(data);
      } catch(e) {
        resolve({ error: e.message });
      }
    };
    reader.readAsDataURL(file);
  });
}

/* ═══════════════════════════════════════════════════
   FIRST-TIME USER FLOW
   ═══════════════════════════════════════════════════ */

async function checkFirstTimeUser() {
  const hasMemory = Object.keys(SageMemory._cache).length > 0;
  const hasProfile = localStorage.getItem('sh_profile');
  const shownIntro = localStorage.getItem('sage_intro_shown');

  if (!shownIntro && !hasMemory) {
    setTimeout(() => showFirstConversationPrompt(), 3000);
  }
}

function showFirstConversationPrompt() {
  if (localStorage.getItem('sage_intro_shown')) return;

  const banner = document.createElement('div');
  banner.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:white;border:1px solid rgba(29,111,164,.3);border-radius:16px;
    padding:20px 24px;max-width:420px;width:calc(100vw - 40px);
    z-index:800;box-shadow:0 8px 32px rgba(29,111,164,.2);
    animation:slideUp .4s cubic-bezier(.34,1.56,.64,1);
  `;
  banner.innerHTML = `
    <style>@keyframes slideUp{from{transform:translateX(-50%) translateY(20px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}</style>
    <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px;">
      <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🧠</div>
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px;">Dr. Sage wants to meet you</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.5;">Before I start watching your numbers, I want to know a bit about you. It takes 2 minutes and shapes everything I do from here.</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="startFirstConversation()" style="flex:1;background:linear-gradient(135deg,var(--blue),var(--cyan));color:white;border:none;border-radius:10px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;">
        🎤 Talk to Dr. Sage
      </button>
      <button onclick="this.closest('div[style]').remove();localStorage.setItem('sage_intro_shown','1')" style="background:var(--bg);border:1px solid var(--border2);color:var(--muted);border-radius:10px;padding:11px 16px;font-size:12px;cursor:pointer;">
        Later
      </button>
    </div>
  `;
  document.body.appendChild(banner);
}

function startFirstConversation() {
  document.querySelectorAll('[style*="slideUp"]').forEach(el => el.remove());
  localStorage.setItem('sage_intro_shown', '1');

  // Open voice consult in intro mode
  if (typeof openVoiceConsult === 'function') {
    openVoiceConsult('__intro__', 'Getting to know you', null, true);
  }
}

/* ═══════════════════════════════════════════════════
   AUTH UI
   ═══════════════════════════════════════════════════ */

function showAuthModal(mode = 'signin') {
  const existing = document.getElementById('sage-auth-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'sage-auth-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(30,40,60,.6);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;';

  modal.innerHTML = `
    <div style="background:white;border-radius:20px;padding:28px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.15);">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:24px;font-weight:800;color:var(--blue);">SageHealth</div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px;">${mode === 'signup' ? 'Create your account' : 'Sign in to sync your data'}</div>
      </div>
      ${mode === 'signup' ? '<div style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;color:var(--text);display:block;margin-bottom:4px;">Your name</label><input id="auth-name" type="text" placeholder="Frank" style="width:100%;border:1px solid var(--border2);border-radius:8px;padding:10px 12px;font-size:14px;font-family:var(--font);outline:none;box-sizing:border-box;"></div>' : ''}
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;font-weight:600;color:var(--text);display:block;margin-bottom:4px;">Email</label>
        <input id="auth-email" type="email" placeholder="you@example.com" style="width:100%;border:1px solid var(--border2);border-radius:8px;padding:10px 12px;font-size:14px;font-family:var(--font);outline:none;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:600;color:var(--text);display:block;margin-bottom:4px;">Password</label>
        <input id="auth-password" type="password" placeholder="••••••••" style="width:100%;border:1px solid var(--border2);border-radius:8px;padding:10px 12px;font-size:14px;font-family:var(--font);outline:none;box-sizing:border-box;">
      </div>
      <div id="auth-error" style="display:none;background:var(--red-bg);border:1px solid rgba(192,57,43,.2);border-radius:8px;padding:9px 12px;font-size:12px;color:var(--red);margin-bottom:12px;"></div>
      <button onclick="handleAuth('${mode}')" style="width:100%;background:var(--blue);color:white;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:12px;">
        ${mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      <div style="text-align:center;font-size:12px;color:var(--muted);">
        ${mode === 'signup'
          ? 'Already have an account? <button onclick="showAuthModal(\'signin\')" style="background:none;border:none;color:var(--blue);cursor:pointer;font-size:12px;font-weight:600;">Sign in</button>'
          : 'New to SageHealth? <button onclick="showAuthModal(\'signup\')" style="background:none;border:none;color:var(--blue);cursor:pointer;font-size:12px;font-weight:600;">Create account</button>'
        }
      </div>
      <div style="text-align:center;margin-top:12px;">
        <button onclick="document.getElementById(\'sage-auth-modal\').remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;">Continue without account</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleAuth(mode) {
  const email = document.getElementById('auth-email')?.value?.trim();
  const password = document.getElementById('auth-password')?.value;
  const name = document.getElementById('auth-name')?.value?.trim();
  const errEl = document.getElementById('auth-error');

  if (!email || !password) {
    if (errEl) { errEl.textContent = 'Please enter your email and password.'; errEl.style.display = 'block'; }
    return;
  }

  try {
    const result = mode === 'signup'
      ? await SB.signUp(email, password, name)
      : await SB.signIn(email, password);

    if (result.error || result.msg) {
      if (errEl) { errEl.textContent = result.error_description || result.msg || 'Authentication failed.'; errEl.style.display = 'block'; }
      return;
    }

    document.getElementById('sage-auth-modal')?.remove();
    await SageSync.syncAll();
    updateAuthUI();
    if (typeof showToast !== 'undefined') showToast('✓ Signed in', 'Your data is now syncing across devices.');

  } catch(e) {
    if (errEl) { errEl.textContent = 'Connection error. Please try again.'; errEl.style.display = 'block'; }
  }
}

function updateAuthUI() {
  const user = SB.getCurrentUser();
  const authBtn = document.getElementById('auth-btn');
  if (!authBtn) return;
  if (user) {
    authBtn.textContent = '✓ Syncing';
    authBtn.style.color = 'var(--green)';
    authBtn.onclick = () => {
      if (confirm('Sign out? Your data stays on this device.')) {
        SB.signOut();
        updateAuthUI();
      }
    };
  } else {
    authBtn.textContent = '☁ Sync data';
    authBtn.style.color = 'var(--blue)';
    authBtn.onclick = () => showAuthModal('signin');
  }
}

/* ── BOOT ────────────────────────────────────────── */
window.addEventListener('load', async () => {
  // Initialize session
  if (SB.isAuthenticated()) {
    const session = SB.getSession();
    SB.userId = session?.user?.id;
  }

  // Load memory
  await SageMemory.load();

  // Sync if authenticated
  if (SB.isAuthenticated()) {
    SageSync.syncAll();
  }

  // Check if new user
  setTimeout(checkFirstTimeUser, 4000);

  // Update auth UI
  updateAuthUI();
});
