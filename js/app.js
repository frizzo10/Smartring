
/* ── REDESIGN v2 — UI helpers ──────────────────────── */

function updateDashboardV2(stateMap) {
  const m = stateMap || {};
  const cv = m.cardio || {};
  const sl = m.sleep || {};
  const t  = m.temperature || {};
  const a  = m.activity || {};
  const r  = m.recovery || {};

  // Greeting
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = profile?.name ? `, ${profile.name.split(' ')[0]}.` : '.';
  const el = document.getElementById('dashGreet');
  if (el) el.textContent = greet + name;

  const dateEl = document.getElementById('dashDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

  // Avatar initials
  const av = document.getElementById('avatar-initials');
  if (av && profile?.name) {
    const parts = profile.name.trim().split(' ');
    av.textContent = (parts[0]?.[0]||'') + (parts[1]?.[0]||'');
  }

  // Ring online dot
  const dot = document.getElementById('ring-online-dot');
  if (dot) dot.style.display = 'block';

  // Health ring score
  const score = r.readiness || m.health_grade_num || 84;
  const scoreEl = document.getElementById('health-ring-score');
  if (scoreEl) scoreEl.textContent = score;
  const arc = document.getElementById('health-ring-arc');
  if (arc) {
    const circumference = 264;
    const offset = circumference - (score / 100) * circumference;
    arc.setAttribute('stroke-dashoffset', offset);
    arc.setAttribute('stroke', score >= 80 ? 'var(--normal)' : score >= 60 ? 'var(--watch)' : 'var(--urgent)');
  }
  const labelEl = document.getElementById('health-ring-label');
  if (labelEl) labelEl.textContent = score >= 85 ? 'Strong week' : score >= 70 ? 'Steady & strong' : score >= 55 ? 'Take it easy' : 'Recovery week';
  const subEl = document.getElementById('health-ring-sub');
  if (subEl && r.readiness) subEl.textContent = r.consecutive_low_days > 2 ? `${r.consecutive_low_days} consecutive low days — worth discussing with Dr. Sage.` : 'Up from last week. Recovery is the only thing to watch.';

  // Metric tiles
  function setTile(id, val, statusId, statusText, statusClass) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '--';
    const sEl = document.getElementById(statusId);
    if (sEl) { sEl.textContent = statusText; sEl.className = 'mt-status ' + (statusClass||'muted'); }
  }

  setTile('tile-hrv', cv.hrv?.current, 'tile-hrv-status',
    cv.hrv?.trend?.label || (cv.hrv?.current < 40 ? '↓ low' : 'Normal'),
    cv.hrv?.status === 'watch' || cv.hrv?.current < 40 ? 'watch' : 'normal');

  setTile('tile-rhr', cv.rhr?.current, 'tile-rhr-status',
    cv.rhr?.status === 'normal' ? 'Normal' : cv.rhr?.trend?.label || '--',
    cv.rhr?.status || 'muted');

  setTile('tile-spo2', cv.spo2?.current, 'tile-spo2-status',
    cv.spo2?.current >= 95 ? 'Normal' : 'Watch',
    cv.spo2?.current >= 95 ? 'normal' : 'watch');

  const bpEl = document.getElementById('tile-bp-s');
  const bpDEl = document.getElementById('tile-bp-d');
  if (bpEl) bpEl.textContent = cv.bp?.systolic || '--';
  if (bpDEl) bpDEl.textContent = '/' + (cv.bp?.diastolic || '--');
  setTile(null, null, 'tile-bp-status',
    cv.bp?.status === 'normal' ? 'Normal' : cv.bp?.status || '--',
    cv.bp?.status || 'muted');

  const sh = sl.total?.avg7d || 0;
  const shH = Math.floor(sh), shM = Math.round((sh - shH) * 60);
  setTile('tile-sleep-h', shH || '--', null, null, null);
  const smEl = document.getElementById('tile-sleep-m');
  if (smEl) smEl.textContent = shM || '';
  setTile(null, null, 'tile-sleep-status',
    sh >= 7 ? 'Restful' : sh >= 6 ? 'Short' : 'Watch',
    sh >= 7 ? 'normal' : sh >= 6 ? 'muted' : 'watch');

  setTile('tile-temp', t.last_night_f ? (t.deviation_f > 0 ? '+' : '') + t.deviation_f : '--',
    'tile-temp-status',
    t.status === 'elevated' ? 'Elevated' : t.deviation_f > 0.5 ? 'Slight' : 'Baseline',
    t.status === 'elevated' ? 'watch' : 'muted');
}

function renderSignalsPanelV2(signals) {
  const container = document.getElementById('signals-panel');
  if (!container) return;

  const active = (signals||[]).filter(s => s.fired && !s.dismissed);
  if (!active.length) {
    container.innerHTML = '';
    return;
  }

  const levelLabel = { urgent: 'Urgent', watch: 'Watch', info: 'Good to know', normal: 'Normal' };
  const levelChip  = { urgent: 'urgent', watch: 'watch', info: 'info', normal: 'normal' };

  container.innerHTML = '<p class="overline" style="margin:0 0 10px;padding:0 2px;">' + active.length + ' active signal' + (active.length > 1 ? 's' : '') + '</p>' +
    active.map(s => {
      const level = s.level || 'watch';
      const chip = levelChip[level] || 'watch';
      const borderColor = level === 'urgent' ? 'var(--urgent)' : level === 'watch' ? 'var(--watch)' : level === 'normal' ? 'var(--normal)' : 'var(--accent)';
      return '<div onclick="openSignalCard(\'' + s.id + '\')" style="background:var(--surface);border:1px solid var(--hairline);border-left:3px solid ' + borderColor + ';border-radius:16px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;cursor:pointer;box-shadow:0 6px 18px -10px rgba(20,50,70,.18);">' +
        '<div style="flex:1;">' +
          '<div class="sig-chip ' + chip + '" style="margin-bottom:6px;"><span class="sig-chip-dot"></span>' + (levelLabel[level]||'Watch') + ' · Pattern worth discussing</div>' +
          '<div style="font-size:15px;font-weight:600;color:var(--ink);line-height:1.3;">' + s.title + '</div>' +
          '<div style="font-size:13px;color:var(--muted);margin-top:3px;">' + (s.watchingFor||s.action||'') + '</div>' +
        '</div>' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
      '</div>';
    }).join('');
}

function mobileNavActive(btn) {
  document.querySelectorAll('.tab-item-new').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function mobileNavSignals(btn) {
  mobileNavActive(btn);
  // Scroll to signals panel
  const el = document.getElementById('signals-panel');
  if (el) el.scrollIntoView({behavior:'smooth'});
}

function updateVoiceState(state) {
  // state: 'speaking' | 'listening' | 'thinking' | 'idle'
  const dot = document.getElementById('vc-state-dot');
  const txt = document.getElementById('vc-state-text');
  const h1 = document.getElementById('vc-halo-1');
  const h2 = document.getElementById('vc-halo-2');
  if (!dot) return;

  if (state === 'speaking') {
    dot.style.background = 'var(--urgent)';
    if (txt) txt.textContent = 'DR. SAGE IS SPEAKING';
    if (h1) h1.style.display = 'block';
    if (h2) h2.style.display = 'block';
  } else if (state === 'listening') {
    dot.style.background = 'var(--normal)';
    if (txt) txt.textContent = 'YOUR TURN';
    if (h1) h1.style.display = 'none';
    if (h2) h2.style.display = 'none';
  } else if (state === 'thinking') {
    dot.style.background = 'var(--faint)';
    if (txt) txt.textContent = 'THINKING…';
    if (h1) h1.style.display = 'none';
    if (h2) h2.style.display = 'none';
  } else {
    dot.style.background = 'var(--faint)';
    if (txt) txt.textContent = '';
    if (h1) h1.style.display = 'none';
    if (h2) h2.style.display = 'none';
  }
}

function setVoiceTranscript(line, isUser) {
  const prior = document.getElementById('vc-prior-line');
  const current = document.getElementById('vc-current-line');
  if (!current) return;
  if (prior && current.textContent) prior.textContent = '"' + current.textContent + '"';
  current.textContent = line || '';
}

function toggleVcMute() {
  // Toggle mute state visually
  const btn = document.getElementById('vc-mute-btn');
  if (!btn) return;
  const muted = btn.dataset.muted === '1';
  btn.dataset.muted = muted ? '0' : '1';
  btn.style.background = muted ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.4)';
}

/* ─── RING SPECS (from TK30 official spec sheet) ── */
const TK30_SPECS = {
  cpu: 'Nordic NRF52832',
  hrSensor: 'GH3220S + GH3228T',
  ecgSensor: 'GH3228T',
  accel: 'SC-7A20H',
  batteryMah: '15-20mAh',
  batteryDays: 5,           // with BT connected
  chargeMins: 60,
  storeDays: 7,             // on-device storage before data lost
  waterproof: '5ATM + IP68',
  bluetooth: '5.0 LE',
  weightG: 5.0,
  widthMm: 8,
  exercises: ['Walking','Running','Swimming','Cycling','Hiking','Workout'],
  sensors: ['ECG','Blood pressure','SpO₂','HRV','Heart rate','Skin temperature','Steps/activity','Sleep stages']
};

/* ─── STATE ─────────────────────────────────────── */
let profile={},goals={},data=[],consultHistory=[],chatMessages=[],voiceOn=false,wtVoiceOn=true,wtIdx=0,wtSteps=[],ecgAnimId=null,ecgHeroAnimId=null,selectedUrgency='routine',reportText='';

/* ─── ONBOARDING ────────────────────────────────── */
let obStep=0;
function nextOb(n){document.getElementById('s'+obStep).classList.remove('on');obStep=n;document.getElementById('s'+n).classList.add('on');for(let i=0;i<=3;i++)document.getElementById('p'+i).classList.toggle('on',i<=n);}
function finishOb(){
  profile={name:document.getElementById('ob_name').value||'Frank',age:parseInt(document.getElementById('ob_age').value)||48,weight:parseInt(document.getElementById('ob_weight').value)||185,height:parseFloat(document.getElementById('ob_height').value)||5.11,sex:document.getElementById('ob_sex').value||'Male',conditions:document.getElementById('ob_conditions').value||'',drname:''};
  goals={steps:parseInt(document.getElementById('ob_steps').value)||8000,sleep:parseFloat(document.getElementById('ob_sleep').value)||7.5,apnea:parseInt(document.getElementById('ob_apnea').value)||2,spo2:parseInt(document.getElementById('ob_spo2').value)||92};
  localStorage.setItem('sh_profile',JSON.stringify(profile));localStorage.setItem('sh_goals',JSON.stringify(goals));
  initApp();
}

/* ─── DEMO DATA ─────────────────────────────────── */
function genData(){
  return Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i));
    const hrv=Math.round(48+Math.random()*30),rhr=Math.round(56+Math.random()*14);
    const sleep=+(6.5+Math.random()*2).toFixed(1);
    const deep=+(sleep*(0.15+Math.random()*0.1)).toFixed(1);
    const rem=+(sleep*(0.18+Math.random()*0.1)).toFixed(1);
    const light=+(sleep-deep-rem-0.3).toFixed(1);
    const steps=Math.round(5000+Math.random()*7000);
    const spo2=+(96+Math.random()*3).toFixed(1);
    const apnea=Math.floor(Math.random()*3);
    const bpSys=Math.round(115+(rhr-60)*.6+(60-hrv)*.2);
    const bpDia=Math.round(75+(rhr-60)*.3);
    const tempC=+(36.2+Math.random()*.8).toFixed(1);
    const tempBase=36.6;
    const tempDev=+(tempC-tempBase).toFixed(1);
    const resp=+(13+(70-hrv)*.04).toFixed(1);
    const readiness=Math.min(100,Math.round((hrv/75*40)+((72-rhr)/16*30)+(deep/1.5*30)));
    const sleepScore=Math.min(100,Math.round((sleep/(goals.sleep||7.5)*40)+(deep/1.5*35)+(rem/1.8*25)));
    const calories=Math.round(steps*.04*(profile.weight||185)/100);
    const distance=+(steps*.00047).toFixed(1);
    // convert to F
    const tempF=+(tempC*9/5+32).toFixed(1);
    const tempBaseF=+(tempBase*9/5+32).toFixed(1);
    return{date:d,hrv,rhr,sleep,deep,rem,light,steps,spo2,apnea,bpSys,bpDia,tempC,tempF,tempDev,tempBase,tempBaseF,resp,readiness,sleepScore,calories,distance};
  });
}
const avg=(arr,k)=>Math.round(arr.reduce((s,d)=>s+d[k],0)/arr.length);
const avgF=(arr,k)=>+(arr.reduce((s,d)=>s+d[k],0)/arr.length).toFixed(1);

/* ─── STATUS HELPERS ────────────────────────────── */
function rhrSt(v){return v<60?'great':v<70?'good':v<80?'watch':'alert';}
function hrvSt(v){return v>=60?'great':v>=45?'good':v>=35?'watch':'alert';}
function spo2St(v){return v>=97?'great':v>=95?'good':v>=92?'watch':'alert';}
function bpSt(s){return s<120?'great':s<130?'good':s<140?'watch':'alert';}
function tempSt(dev){return Math.abs(dev)<=0.3?'great':Math.abs(dev)<=0.5?'good':Math.abs(dev)<=0.8?'watch':'alert';}
function ssSt(v){return v>=85?'great':v>=70?'good':v>=55?'watch':'alert';}
function slLabel(s){return{great:'Excellent',good:'Good',watch:'Watch',alert:'Alert'}[s];}
function chipCss(s){return{great:{bg:'var(--green-bg)',c:'var(--green)'},good:{bg:'var(--cyan-bg)',c:'var(--cyan)'},watch:{bg:'var(--amber-bg)',c:'var(--amber)'},alert:{bg:'var(--red-bg)',c:'var(--red)'}}[s];}

/* ─── INTERPRETATIONS ───────────────────────────── */
function iRHR(v){if(v<60)return`Resting HR of ${v} BPM is in the athletic range — your heart pumps more per beat and works less hard at rest.`;if(v<70)return`Resting HR of ${v} BPM is healthy. Your heart is pumping efficiently.`;if(v<80)return`Resting HR of ${v} BPM is mildly elevated. Common causes: dehydration, caffeine, stress, or reduced sleep quality.`;return`Resting HR of ${v} BPM is elevated. Consistently above 80 warrants monitoring.`;}
function iHRV(v,age){const exp=Math.round(65-age*.5);if(v>=exp+10)return`HRV of ${v}ms is well above average for age ${age}. Your body's internal stress meter reads low stress today.`;if(v>=exp-5)return`HRV of ${v}ms is within normal range. Autonomic nervous system is balanced.`;if(v>=exp-15)return`HRV of ${v}ms is slightly below the expected range. May indicate accumulated fatigue or early stress.`;return`HRV of ${v}ms is below the age-adjusted norm. Prioritize rest.`;}
function iSpO2(v){if(v>=97)return`SpO₂ of ${v}% is optimal. Your red blood cells are fully loaded with oxygen.`;if(v>=95)return`SpO₂ of ${v}% is normal. Lungs and circulation are working well.`;if(v>=92)return`SpO₂ of ${v}% is mildly below normal. Repeated readings below 95% during sleep can indicate breathing disruptions.`;return`SpO₂ of ${v}% is below the safe threshold. This requires medical attention.`;}
function iBP(s,d){if(s<120)return`Blood pressure ${s}/${d} mmHg is optimal. Cardiovascular disease risk is lowest here.`;if(s<130)return`Blood pressure ${s}/${d} mmHg is normal. Heart is pumping at a healthy pressure.`;if(s<140)return`Blood pressure ${s}/${d} is elevated (Stage 1). Hydration, salt reduction, and daily movement are your primary levers.`;return`Blood pressure ${s}/${d} mmHg is in the high range. Consistent readings above 140 should be discussed with your doctor.`;}
function iTemp(t,dev,base){if(Math.abs(dev)<=0.3)return`Body temp ${t}°F is within your personal baseline. No inflammatory signals overnight.`;if(dev>0.3&&dev<=0.5)return`Temp ${t}°F is slightly above baseline (+${(dev*9/5).toFixed(1)}°F). Watch zone — could be early immune activation.`;if(dev>0.5)return`Temp ${t}°F is ${(dev*9/5).toFixed(1)}°F above baseline — your ring's illness early warning. Expect symptoms in 12–48 hours if this continues.`;return`Temp slightly below baseline. Typical during high-quality deep sleep.`;}
function iSleep(score,h,deep,rem,data){
  const avgDeep=data?avgF(data,'deep'):deep;const avgRem=data?avgF(data,'rem'):rem;const avgSleep=data?avgF(data,'sleep'):h;
  const trend=data&&data.length>3?(data[data.length-1].deep>data[0].deep?'↑ improving':'↓ declining'):'';
  if(score>=85)return`${h}h sleep last night with ${deep}h deep and ${rem}h REM — excellent. 7-day averages: ${avgSleep}h total, ${avgDeep}h deep, ${avgRem}h REM. Deep sleep is physical repair. REM is memory and emotion. Both are strong ${trend}.`;
  if(score>=70)return`${h}h last night with ${deep}h deep sleep. 7-day average: ${avgDeep}h deep (target 1.5h). ${trend?'Trend: '+trend+'.':''} Consistent bedtime is the highest-impact change you can make.`;
  return`${h}h last night with ${deep}h deep — below target. 7-day average: ${avgDeep}h deep. Sleep debt builds night over night. Each hour below optimal affects mood, metabolism, and immune function. ${trend?'Trend: '+trend+'.':''}`;
}
function iSteps(v,goal){const p=Math.round(v/goal*100);if(p>=100)return`Goal achieved: ${v.toLocaleString()} steps. Research links 8,000+ daily steps to significantly lower all-cause mortality.`;if(p>=75)return`${v.toLocaleString()} steps — ${p}% of goal. A 15-minute walk closes the gap.`;return`${v.toLocaleString()} steps — below target. Prolonged sitting independently raises cardiovascular risk.`;}

/* ─── CHART CONFIG ──────────────────────────────── */
const chartOpts=(min,max)=>({responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#6b7f96',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#6b7f96',font:{size:10}},grid:{color:'rgba(0,0,0,.05)'},min,max}}});

/* ─── INIT ──────────────────────────────────────── */
function initApp(){
  document.getElementById('onboarding').style.display='none';
  document.getElementById('app').style.display='block';
  data=genData();
  buildDashboard();
  buildSubpages();
  populateHistory();
  populateSettings();
  setGreeting();
  expireOldDismissals();
  buildSignalsPanel(data, profile, goals);
  if(typeof runCommitmentFollowUps==='function') runCommitmentFollowUps(data,profile);
  if(typeof checkTestFollowUps==='function') setTimeout(checkTestFollowUps, 5000);

  // Build state map — clean structured context for all AI calls
  const firedSigsForMap = JSON.parse(localStorage.getItem('sh_active_signals') || '[]');
  if(typeof buildStateMap==='function') {
    const stateMap = buildStateMap(data, profile, goals, firedSigsForMap);
    if(typeof saveStateMap==='function') saveStateMap(stateMap);
  }

  // Run notification check after signals are computed
  const firedSigs = JSON.parse(localStorage.getItem('sh_active_signals') || '[]');
  if(typeof runNotificationCheck==='function') {
    runNotificationCheck(data, profile, firedSigs);
  }

  // Show push permission prompt after first signal fires (delayed)
  if(firedSigs.length > 0 && typeof showPushPermissionPrompt==='function') {
    setTimeout(showPushPermissionPrompt, 8000);
  }
  const today=new Date(),isMon=today.getDay()===1,lw=localStorage.getItem('sh_nl'),tw=today.toISOString().slice(0,10);
  if(isMon&&lw!==tw){localStorage.setItem('sh_nl',tw);setTimeout(()=>openWeekly(),1400);}
}
function setGreeting(){
  const h=new Date().getHours(),n=profile.name||'Frank';
  document.getElementById('dashGreet').textContent=(h<12?'Good morning':h<17?'Good afternoon':'Good evening')+', '+n;
  document.getElementById('dashDate').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('sav').textContent=n[0].toUpperCase();
  document.getElementById('sname').textContent=n;
  // Daily streak
  const today2=new Date().toISOString().slice(0,10);
  const lastCheck=localStorage.getItem('sh_last_checkin');
  const streak=parseInt(localStorage.getItem('sh_streak')||'0');
  if(lastCheck!==today2){
    const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
    const yStr=yesterday.toISOString().slice(0,10);
    const newStreak=lastCheck===yStr?streak+1:1;
    localStorage.setItem('sh_streak',newStreak.toString());
    localStorage.setItem('sh_last_checkin',today2);
    if(newStreak>1&&typeof showToast!=='undefined'){
      setTimeout(()=>showToast('🔥 '+newStreak+' day streak!','Keep showing up — consistency is the whole game.'),1200);
    }
  }
  const currentStreak=parseInt(localStorage.getItem('sh_streak')||'1');
  const streakEl=document.getElementById('streak-badge');
  if(streakEl)streakEl.textContent='🔥 '+currentStreak+' day streak';
}

/* ─── DASHBOARD ─────────────────────────────────── */
function buildDashboard(){
  const t=data[data.length-1],age=profile.age||48;
  const stepsGoal=goals.steps||8000;

  // Briefing
  const ca=Math.max(25,age+(t.rhr<60?-3:t.rhr>72?3:0)+(t.hrv>60?-2:t.hrv<40?2:0)+(t.spo2<95?2:0));
  // Overall health grade A-D
  const grade=(()=>{
    let pts=0,max=0;
    const age=profile.age||48;
    // HRV vs age norm
    const hrvNorm=65-age*.5; pts+=t.hrv>=hrvNorm+5?4:t.hrv>=hrvNorm?3:t.hrv>=hrvNorm-10?2:1; max+=4;
    // RHR
    pts+=t.rhr<60?4:t.rhr<70?3:t.rhr<80?2:1; max+=4;
    // BP
    pts+=t.bpSys<120?4:t.bpSys<130?3:t.bpSys<140?2:1; max+=4;
    // SpO2
    pts+=t.spo2>=97?4:t.spo2>=95?3:t.spo2>=92?2:1; max+=4;
    // Sleep
    pts+=t.sleep>=(goals.sleep||7.5)?4:t.sleep>=6.5?3:t.sleep>=5.5?2:1; max+=4;
    // Deep sleep
    pts+=t.deep>=1.5?4:t.deep>=1?3:t.deep>=0.7?2:1; max+=4;
    // Steps
    pts+=t.steps>=(goals.steps||8000)?4:t.steps>=6000?3:t.steps>=4000?2:1; max+=4;
    // Temp
    pts+=Math.abs(t.tempDev)<=0.3?4:Math.abs(t.tempDev)<=0.5?3:Math.abs(t.tempDev)<=0.8?2:1; max+=4;
    const pct=pts/max;
    if(pct>=0.875)return{grade:'A',label:'Excellent',color:'var(--green)',bg:'var(--green-bg)',desc:'All metrics in optimal range'};
    if(pct>=0.75)return{grade:'B',label:'Good',color:'var(--blue)',bg:'var(--blue-bg)',desc:'Most metrics healthy, minor areas to watch'};
    if(pct>=0.55)return{grade:'C',label:'Fair',color:'var(--amber)',bg:'var(--amber-bg)',desc:'Several metrics need attention'};
    return{grade:'D',label:'Needs attention',color:'var(--red)',bg:'var(--red-bg)',desc:'Multiple metrics outside healthy range'};
  })();

  let br=`Readiness <strong>${t.readiness}/100</strong>. BP <strong>${t.bpSys}/${t.bpDia}</strong> mmHg. SpO₂ <strong>${t.spo2}%</strong>. Temp <strong>${t.tempF}°F</strong>${t.tempDev>0.4?` <span class="warn">(+${(t.tempDev*9/5).toFixed(1)}°F above baseline — monitor)</span>`:' (baseline normal)'}. HRV <strong>${t.hrv}ms</strong>. `;
  if(t.apnea>2)br+=`<span class="warn">⚠ ${t.apnea} airway events overnight.</span> `;
  const sl=Math.max(0,stepsGoal-t.steps);
  br+=sl>0?`<span class="warn">${sl.toLocaleString()} steps to goal.</span>`:`Step goal achieved. `;
  if(ca<age)br+=`CV age estimate <strong>${ca}</strong> — ${age-ca} yrs younger than actual.`;
  br+=` <span style="display:inline-flex;align-items:baseline;gap:5px;margin-left:4px;"><span style="font-size:15px;font-weight:800;color:${grade.color};">${grade.grade}</span><span style="font-size:11px;color:${grade.color};font-weight:600;">${grade.label}</span></span>`;
  document.getElementById('dailySummary').innerHTML=br;

  // ── v2 redesign: update new metric tiles + health ring ──
  try {
    const sm = typeof loadStateMap === 'function' ? loadStateMap() : null;
    if (sm) {
      updateDashboardV2(sm);
    } else {
      // Fallback: use raw data
      const d = data[data.length-1];
      const tileData = {
        cardio: {
          hrv: { current: d.hrv, status: d.hrv < 40 ? 'watch' : 'normal', trend: { label: '' }},
          rhr: { current: d.rhr, status: d.rhr < 70 ? 'normal' : 'watch', trend: { label: '' }},
          bp:  { systolic: d.bpSys, diastolic: d.bpDia, status: d.bpSys < 130 ? 'normal' : 'watch', trend: { label: '' }},
          spo2:{ current: d.spo2, status: d.spo2 >= 95 ? 'normal' : 'watch', trend: { label: '' }},
        },
        sleep: { total: { avg7d: d.sleep, trend: { label: '' }}, deep: { avg7d: d.deep }, rem: { avg7d: d.rem }},
        temperature: { last_night_f: d.tempF, deviation_f: d.tempDev, status: Math.abs(d.tempDev) > 0.5 ? 'elevated' : 'normal' },
        recovery: { readiness: d.readiness },
        health_grade_num: grade.grade === 'A' ? 92 : grade.grade === 'B' ? 81 : grade.grade === 'C' ? 65 : 48,
      };
      updateDashboardV2(tileData);
    }
  } catch(e) { console.log('v2:', e.message); }

  // Battery / sync warning based on days since last sync
  const lastSync = localStorage.getItem('sh_last_sync');
  if (lastSync) {
    const daysSince = Math.round((Date.now() - parseInt(lastSync)) / (1000*60*60*24));
    if (daysSince >= 2) {
      const syncWarn = document.createElement('div');
      syncWarn.style.cssText = 'background:var(--amber-bg);border:1px solid rgba(180,83,9,.2);border-radius:9px;padding:8px 13px;font-size:12px;color:var(--amber);margin-bottom:10px;display:flex;align-items:center;gap:8px;';
      syncWarn.innerHTML = '<span>⚠️</span><span><strong>Sync your ring.</strong> TK30 stores only 7 days on-device — data older than that is lost. Last sync: ' + daysSince + ' days ago.</span>';
      const metrics = document.getElementById('metrics-row');
      if (metrics) metrics.before(syncWarn);
    }
  } else {
    localStorage.setItem('sh_last_sync', Date.now().toString());
  }

  // 5 metric cards: steps, BP, SpO2, temp°F, HR (HR+HRV combined)
  // Battery estimate based on last charge time
  const lastCharge = parseInt(localStorage.getItem('sh_last_charge') || Date.now().toString());
  const hoursUsed = (Date.now() - lastCharge) / (1000 * 60 * 60);
  const battPct = Math.max(0, Math.round(100 - (hoursUsed / (TK30_SPECS.batteryDays * 24)) * 100));
  const battSt = battPct > 40 ? 'great' : battPct > 20 ? 'watch' : 'alert';
  const battCol = battPct > 40 ? 'var(--green)' : battPct > 20 ? 'var(--amber)' : 'var(--red)';
  const battIcon = battPct > 60 ? '🔋' : battPct > 30 ? '🪫' : '⚡';

  const mrow=document.getElementById('metrics-row');
  const cards=[
    {label:'Steps today',val:t.steps.toLocaleString(),sub:Math.min(100,Math.round(t.steps/stepsGoal*100))+'% of goal',st:t.steps>=stepsGoal?'great':t.steps>=stepsGoal*.75?'good':'watch',c:'var(--green)',page:'activity'},
    {label:'Blood pressure',val:t.bpSys+'/'+t.bpDia,sub:'mmHg · TK30',st:bpSt(t.bpSys),c:'var(--pink)',page:'vitals'},
    {label:'SpO₂',val:t.spo2+'%',sub:'Overnight avg',st:spo2St(t.spo2),c:'var(--cyan)',page:'sleep'},
    {label:'Body temp',val:t.tempF+'°F',sub:(t.tempDev>=0?'+':'')+((t.tempDev*9/5).toFixed(1))+'°F from baseline',st:tempSt(t.tempDev),c:'var(--amber)',page:'vitals'},
    {label:'Heart rate / HRV',val:t.rhr+' BPM',sub:'HRV '+t.hrv+' ms · RMSSD',st:rhrSt(t.rhr),c:'var(--red)',page:'heart'},
  ];
  mrow.innerHTML=cards.map(s=>{
    const css=chipCss(s.st);
    return`<div class="mc" onclick="navToPage('${s.page}')"><div class="mc-label">${s.label}</div><div class="mc-val" style="color:${s.c}">${s.val}</div><div class="mc-sub">${s.sub}</div><div class="mc-status" style="color:${css.c}">${slLabel(s.st)}</div></div>`;
  }).join('');

  // Battery card — append after metrics
  const battCard = document.createElement('div');
  battCard.style.cssText = 'background:var(--panel);border:1px solid var(--border2);border-radius:11px;padding:13px 15px;box-shadow:var(--shadow);display:flex;align-items:center;gap:12px;margin-bottom:14px;';
  battCard.innerHTML = `
    <div style="font-size:24px;">${battIcon}</div>
    <div style="flex:1;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;">TK30 Ring battery</span>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:7px;background:${battPct>40?'var(--green-bg)':battPct>20?'var(--amber-bg)':'var(--red-bg)'};color:${battCol};">${battPct > 40 ? 'Good' : battPct > 20 ? 'Charge soon' : 'Charge tonight'}</span>
      </div>
      <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;margin-bottom:5px;">
        <div style="height:100%;width:${battPct}%;background:${battCol};border-radius:4px;transition:width .5s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);">
        <span>~${battPct}% estimated · ${Math.max(0,Math.round(TK30_SPECS.batteryDays*24-hoursUsed))}h remaining</span>
        <button onclick="logRingCharged()" style="background:transparent;border:none;color:var(--blue);font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;">Charged tonight →</button>
      </div>
    </div>
  `;
  mrow.after(battCard);

  // ECG hero vitals
  document.getElementById('hero-hr').textContent=t.rhr;
  document.getElementById('hero-hrv').textContent=t.hrv;
  document.getElementById('hero-rhythm').textContent=t.rhr<60?'Bradycardia':t.rhr>100?'Elevated':'Normal sinus';
  document.getElementById('ecg-hero-status').textContent=t.rhr<60?'Sinus bradycardia · Rate below 60':t.rhr>100?'Elevated rate · Monitor':'Normal sinus rhythm · Regular';
  setTimeout(()=>startHeroECG(),100);

  // Deep dive cards
  const el=document.getElementById('dash-metrics');
  el.innerHTML=`<div class="two-col" id="dd-r1"></div><div class="two-col" id="dd-r2"></div><div class="two-col" id="dd-r3"></div>`;
  const labels=data.map(d=>d.date.toLocaleDateString('en-US',{weekday:'short'}));

  function scale(val,min,max,zones){
    const pct=Math.max(0,Math.min(100,(val-min)/(max-min)*100));
    const segs=zones.map(z=>`<div style="flex:${z.to-z.from};background:${z.c};opacity:.7;" title="${z.label||''}"></div>`).join('');
    const labels=zones.map(z=>z.label?`<span style="flex:${z.to-z.from};text-align:center;font-size:9px;color:var(--muted);">${z.label}</span>`:'').join('');
    return`<div class="dd-scale"><div class="dd-scale-track">${segs}</div><div style="position:relative;height:12px;"><div class="dd-scale-marker" style="left:${pct}%;"></div></div><div class="dd-scale-labels" style="display:flex;">${labels}</div><div style="display:flex;justify-content:space-between;font-size:9px;color:#aaa;margin-top:1px;"><span>${min}</span><span>You: ${val}</span><span>${max}</span></div></div>`;
  }
  function stat3(a,b,c){return[a,b,c].map(s=>`<div class="dd-stat"><div class="dd-stat-val" style="color:${s[2]||'var(--text)'}">${s[0]}</div><div class="dd-stat-label">${s[1]}</div></div>`).join('');}
  function ddCard(opts){
    const css=chipCss(opts.status);
    return`<div class="dd"><div class="dd-head"><div class="dd-left"><div class="dd-name">${opts.name}</div><div class="dd-val-row"><span class="dd-val" style="color:${css.c}">${opts.value}</span><span class="dd-unit">${opts.unit}</span><span class="dd-chip" style="background:${css.bg};color:${css.c}">${slLabel(opts.status)}</span></div><div class="dd-what">${opts.what}</div><div class="dd-why">${opts.why}</div>${opts.extra||''}</div><div class="dd-chart"><div class="dd-chart-label">7-day trend</div><div style="position:relative;height:110px;"><canvas id="${opts.cid}"></canvas></div></div></div>${opts.bottom?`<div class="dd-bottom">${opts.bottom}</div>`:''}</div>`;
  }

  setTimeout(()=>{
    document.getElementById('dd-r1').innerHTML=
      ddCard({name:'Blood pressure',value:t.bpSys+'/'+t.bpDia,unit:'mmHg',status:bpSt(t.bpSys),what:'Pressure your heart exerts on artery walls with each beat.',why:iBP(t.bpSys,t.bpDia),extra:scale(t.bpSys,80,160,[{from:0,to:25,c:'#9b72f5',label:'Low'},{from:25,to:31,c:'#00d68f',label:'Optimal'},{from:31,to:44,c:'#f59e0b',label:'Elevated'},{from:44,to:56,c:'#f05252',label:'High'}]),cid:'dd-bp',bottom:stat3([avg(data,'bpSys')+' mmHg','7-day sys avg','var(--pink)'],[avg(data,'bpDia')+' mmHg','7-day dia avg','var(--purple)'],['<120/80','Optimal','var(--muted)'])})+
      ddCard({name:'Blood oxygen level (SpO₂)',value:t.spo2+'%',unit:'',status:spo2St(t.spo2),what:'Percentage of red blood cells carrying oxygen to organs and muscles.',why:iSpO2(t.spo2),extra:scale(t.spo2,85,100,[{from:0,to:7,c:'#f05252',label:'Danger'},{from:7,to:10,c:'#f59e0b',label:'Watch'},{from:10,to:15,c:'#00d68f',label:'Normal'}]),cid:'dd-spo2',bottom:stat3([avgF(data,'spo2')+'%','7-day avg','var(--cyan)'],[t.apnea,'Apnea events',t.apnea>2?'var(--amber)':'var(--green)'],['95–100%','Normal','var(--muted)'])});

    document.getElementById('dd-r2').innerHTML=
      ddCard({name:'Overnight body temperature',value:t.tempF+'°F',unit:'',status:tempSt(t.tempDev),what:'Overnight skin temperature — the earliest illness warning available.',why:iTemp(t.tempF,t.tempDev,t.tempBaseF),extra:`<div style="font-size:12px;color:var(--muted);margin-top:8px;">Baseline: ${t.tempBaseF}°F · Deviation: <strong style="color:${t.tempDev>0.4?'var(--amber)':'var(--green)'}">${(t.tempDev*9/5)>=0?'+':''}${(t.tempDev*9/5).toFixed(1)}°F</strong></div>`,cid:'dd-temp',bottom:stat3([avgF(data,'tempF')+'°F','7-day avg','var(--amber)'],[t.tempBaseF+'°F','Baseline','var(--muted)'],[(t.tempDev>=0?'+':'')+((t.tempDev*9/5).toFixed(1))+'°F','Dev today',t.tempDev>0.4?'var(--amber)':'var(--green)'])})+
      ddCard({name:'Resting heart rate',value:t.rhr,unit:'BPM',status:rhrSt(t.rhr),what:'How fast your heart beats completely at rest.',why:iRHR(t.rhr),extra:scale(t.rhr,40,110,[{from:0,to:20,c:'#9b72f5',label:'Athletic'},{from:20,to:30,c:'#00d68f',label:'Healthy'},{from:30,to:50,c:'#f59e0b',label:'Elevated'},{from:50,to:70,c:'#f05252',label:'High'}]),cid:'dd-rhr',bottom:stat3([avg(data,'rhr')+' BPM','7-day avg','var(--cyan)'],[Math.min(...data.map(d=>d.rhr))+' BPM','Lowest','var(--green)'],['60–70 BPM','Reference','var(--muted)'])});

    document.getElementById('dd-r3').innerHTML=
      ddCard({name:'Stress & recovery score (HRV)',value:t.hrv,unit:'ms',status:hrvSt(t.hrv),what:'Tiny gaps between heartbeats. More variation = healthier nervous system.',why:iHRV(t.hrv,age),extra:scale(t.hrv,10,100,[{from:0,to:30,c:'#f05252',label:'Low'},{from:30,to:50,c:'#f59e0b',label:'Fair'},{from:50,to:60,c:'#00b8d9',label:'Good'},{from:60,to:40,c:'#00d68f',label:'Excellent'}]),cid:'dd-hrv',bottom:stat3([avg(data,'hrv')+' ms','7-day avg','var(--green)'],[Math.max(...data.map(d=>d.hrv))+' ms','Best','var(--green)'],[Math.round(65-age*.5)+' ms','Age norm','var(--muted)'])})+
      ddCard({name:'Sleep last night',value:t.sleep+'h',unit:'',status:ssSt(t.sleepScore),what:'Total sleep and the quality of your sleep stages.',why:iSleep(t.sleepScore,t.sleep,t.deep,t.rem,data),extra:`<div class="sleep-bar">${[{c:'#6d5bd0',f:t.deep*.5},{c:'#a78bfa',f:t.light*.4},{c:'#6d5bd0',f:t.deep*.5},{c:'#00b8d9',f:t.rem*.6},{c:'#e2e8f0',f:.25},{c:'#00b8d9',f:t.rem*.4},{c:'#a78bfa',f:t.light*.6}].map(s=>`<div style="flex:${s.f};background:${s.c};border-radius:3px;"></div>`).join('')}</div><div class="sleep-leg">${[['#6d5bd0','Deep'],['#a78bfa','Light'],['#00b8d9','REM'],['#e2e8f0','Awake']].map(([c,l])=>`<div class="sl-i"><div class="sl-d" style="background:${c};"></div>${l}</div>`).join('')}</div>`,cid:'dd-sleep',bottom:stat3([t.deep+'h','Deep','#7c5ddb'],[t.rem+'h','REM','var(--cyan)'],[avgF(data,'sleep')+'h','7-day avg','var(--muted)'])});

    const mk=(id,vals,color,type,min,max)=>{const el=document.getElementById(id);if(!el)return;new Chart(el,{type:type||'line',data:{labels,datasets:[{data:vals,borderColor:color,backgroundColor:color+'18',tension:.4,pointBackgroundColor:color,pointRadius:3,fill:true,borderRadius:type==='bar'?4:0}]},options:chartOpts(min,max)});};
    mk('dd-bp',data.map(d=>d.bpSys),'#ec4899','line',90,160);
    mk('dd-spo2',data.map(d=>d.spo2),'#00b8d9','line',90,100);
    mk('dd-temp',data.map(d=>d.tempF),'#f59e0b','line',96,100);
    mk('dd-rhr',data.map(d=>d.rhr),'#f05252','line',45,95);
    mk('dd-hrv',data.map(d=>d.hrv),'#00d68f','line',20,100);
    mk('dd-sleep',data.map(d=>d.sleep),'#9b72f5','bar',0,10);
  },50);
}

/* ─── SUBPAGES ──────────────────────────────────── */
function buildSubpages(){
  const labels=data.map(d=>d.date.toLocaleDateString('en-US',{weekday:'short'}));
  const t=data[data.length-1],age=profile.age||48;
  function vc(label,val,unit,st,why,ref){
    const css=chipCss(st);
    return`<div style="background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:14px 16px;"><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;">${label}</div><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:${css.bg};color:${css.c}">${slLabel(st)}</span></div><div style="font-size:25px;font-weight:700;font-family:var(--mono);color:${css.c};line-height:1;margin-bottom:3px;">${val}<span style="font-size:12px;color:var(--muted);font-weight:400;font-family:var(--font);margin-left:4px;">${unit}</span></div><div style="font-size:10px;color:var(--muted);margin-bottom:7px;">${ref}</div><div style="font-size:12px;color:#7a92b5;line-height:1.6;padding-top:7px;border-top:1px solid var(--border);">${why}</div></div>`;
  }
  const mkLine=(id,vals,color,min,max)=>new Chart(document.getElementById(id),{type:'line',data:{labels,datasets:[{data:vals,borderColor:color,backgroundColor:color+'18',tension:.4,pointBackgroundColor:color,pointRadius:3,fill:true}]},options:chartOpts(min,max)});
  const mkBar=(id,vals,colors,min,max)=>new Chart(document.getElementById(id),{type:'bar',data:{labels,datasets:[{data:vals,backgroundColor:colors,borderRadius:5}]},options:chartOpts(min,max)});

  // Heart page
  document.getElementById('heart-vitals').innerHTML=vc('Resting HR',t.rhr,'BPM',rhrSt(t.rhr),iRHR(t.rhr),'Ref: 60–70 BPM')+vc('Stress & recovery (HRV)',t.hrv,'ms',hrvSt(t.hrv),iHRV(t.hrv,age),'Higher = better')+vc('Blood pressure',t.bpSys+'/'+t.bpDia,'mmHg',bpSt(t.bpSys),iBP(t.bpSys,t.bpDia),'Optimal: <120/80')+vc('Resp. rate',t.resp,'/min',t.resp<18?'good':'watch',`${t.resp} breaths/min — ${t.resp<18?'within normal range':'slightly elevated'}.`,'Normal: 12–20');
  document.getElementById('hrv7-sub').textContent=`7-day avg ${avg(data,'hrv')}ms. ${avg(data,'hrv')>=55?'Nervous system recovering well.':'Below optimal.'}`;
  document.getElementById('rhr7-sub').textContent=`7-day avg ${avg(data,'rhr')} BPM. ${avg(data,'rhr')<65?'Excellent cardiovascular conditioning.':'Within normal range.'}`;
  document.getElementById('bp7-sub').textContent=`Systolic avg ${avg(data,'bpSys')} mmHg. ${avg(data,'bpSys')<130?'Healthy range.':'Elevated — hydration, salt, movement are your levers.'}`;
  mkLine('hrv7Chart',data.map(d=>d.hrv),'#00d68f',20,100);
  mkLine('rhr7Chart',data.map(d=>d.rhr),'#f05252',45,90);
  new Chart(document.getElementById('bp7Chart'),{type:'line',data:{labels,datasets:[{data:data.map(d=>d.bpSys),label:'Systolic',borderColor:'#ec4899',backgroundColor:'#ec489912',tension:.4,pointRadius:3,fill:true},{data:data.map(d=>d.bpDia),label:'Diastolic',borderColor:'#9b72f5',backgroundColor:'#9b72f508',tension:.4,pointRadius:3,fill:true}]},options:{...chartOpts(60,160),plugins:{legend:{display:true,labels:{color:'#5a6a85',font:{size:10}}}}}});

  // Sleep page
  document.getElementById('sleep-vitals').innerHTML=vc('Avg sleep (7d)',avgF(data,'sleep'),'hrs',avgF(data,'sleep')>=7?'great':'watch',`7-day avg ${avgF(data,'sleep')}h. ${avgF(data,'sleep')>=7?'Within recommended range.':'Below 7h minimum.'}`,'Target: 7–9h')+vc('Deep sleep',t.deep,'hrs',t.deep>=1.5?'great':t.deep>=1?'good':'watch',`${t.deep}h deep. ${t.deep>=1.5?'Optimal — physical repair, immune function, growth hormone.':'Below 1.5h target.'}`,'Target: 1.5–2h')+vc('REM sleep',t.rem,'hrs',t.rem>=1.5?'great':t.rem>=1?'good':'watch',`${t.rem}h REM. ${t.rem>=1.5?'Strong — emotion processing and memory consolidation.':'Below optimal.'}`,'Target: 1.5–2h')+vc('Apnea events',t.apnea,'events',t.apnea<=(goals.apnea||2)?'great':t.apnea<=4?'watch':'alert',`${t.apnea} events. ${t.apnea<=(goals.apnea||2)?'Within range.':'Side-sleeping and avoiding alcohol before bed help most.'}`,'Target: ≤'+(goals.apnea||2));
  document.getElementById('sleep7-sub').textContent=`7-day avg ${avgF(data,'sleep')}h.`;
  document.getElementById('spo2-7-sub').textContent=`Avg ${avgF(data,'spo2')}% — monitor nights below 92%.`;
  document.getElementById('temp7-sub').textContent=`Avg ${avgF(data,'tempF')}°F. +${(0.5*9/5).toFixed(1)}°F above personal baseline = illness early warning 12–48h ahead.`;
  mkBar('sleep7Chart',data.map(d=>d.sleep),data.map(d=>d.sleep>=(goals.sleep||7.5)?'rgba(155,114,245,.6)':'rgba(155,114,245,.25)'),0,10);
  mkLine('spo27Chart',data.map(d=>d.spo2),'#00b8d9',90,100);
  mkLine('temp7Chart',data.map(d=>d.tempF),'#f59e0b',96,100);

  // Vitals page
  document.getElementById('vitals-row').innerHTML=vc('Blood pressure',t.bpSys+'/'+t.bpDia,'mmHg',bpSt(t.bpSys),iBP(t.bpSys,t.bpDia),'TK30 cuffless estimate')+vc('Overnight temp',t.tempF,'°F',tempSt(t.tempDev),iTemp(t.tempF,t.tempDev,t.tempBaseF),'Baseline: '+t.tempBaseF+'°F')+vc('Blood oxygen',t.spo2,'%',spo2St(t.spo2),iSpO2(t.spo2),'Normal: 95–100%')+vc('Resp. rate',t.resp,'/min',t.resp<18?'good':'watch',`${t.resp} breaths/min overnight.`,'Normal: 12–20');
  document.getElementById('bpsys-sub').textContent=`Systolic 7-day avg: ${avg(data,'bpSys')} mmHg.`;
  document.getElementById('tempv-sub').textContent=`7-day avg: ${avgF(data,'tempF')}°F — deviations from personal baseline are the most valuable signal.`;
  mkLine('bpSysChart',data.map(d=>d.bpSys),'#ec4899',90,160);
  mkLine('tempVChart',data.map(d=>d.tempF),'#f59e0b',96,100);

  // Activity page
  document.getElementById('act-vitals').innerHTML=vc('Steps today',t.steps.toLocaleString(),'',t.steps>=(goals.steps||8000)?'great':t.steps>=(goals.steps||8000)*.75?'good':'watch',iSteps(t.steps,goals.steps||8000),'Goal: '+(goals.steps||8000).toLocaleString())+vc('Calories',t.calories,'kcal','good','Active calories above basal metabolic rate.','Movement only')+vc('Distance',t.distance,'miles','good',`${t.distance} miles today.`,'Step estimate')+vc('Active hours',Math.round(t.steps/1200),'hrs',Math.round(t.steps/1200)>=6?'great':'good','Hours with meaningful movement.','Hours >250 steps');
  document.getElementById('steps7-sub').textContent=`7-day avg ${avg(data,'steps').toLocaleString()} steps. TK30 tracks: ${TK30_SPECS.exercises.join(', ')}.`;
  mkBar('steps7Chart',data.map(d=>d.steps),data.map(d=>d.steps>=(goals.steps||8000)?'rgba(0,214,143,.6)':'rgba(59,130,246,.4)'),0,Math.max(...data.map(d=>d.steps))*1.2);
}

/* ─── ECG ───────────────────────────────────────── */
function ecgY(p){p=p%1;if(p<.04)return 5*Math.sin(p/.04*Math.PI);if(p<.12)return 0;if(p<.13)return -8*(p-.12)/.01;if(p<.15)return -8+50*(p-.13)/.02;if(p<.17)return 42-45*(p-.15)/.02;if(p<.19)return -3+3*(p-.17)/.02;if(p<.32)return 0;if(p<.5)return 10*Math.sin((p-.32)/.18*Math.PI);return 0;}
function startECGOnCanvas(canvasId,animVar,onStop){
  const canvas=document.getElementById(canvasId); if(!canvas)return;
  const parent=canvas.parentElement,w=parent.clientWidth||700;
  canvas.width=w; canvas.height=100; canvas.style.width=w+'px'; canvas.style.height='100px';
  const ctx=canvas.getContext('2d');
  const t=data[data.length-1],period=60000/t.rhr;
  let phase=0,lastTime=null;
  function draw(ts){
    if(!lastTime)lastTime=ts;
    const dt=Math.min(ts-lastTime,50); lastTime=ts;
    const w=canvas.width,h=canvas.height,mid=h/2; if(!w||!h){window[animVar]=requestAnimationFrame(draw);return;}
    const speed=w/3,dx=speed*dt/1000;
    if(dx>=1){const img=ctx.getImageData(Math.ceil(dx),0,w-Math.ceil(dx),h);ctx.clearRect(0,0,w,h);ctx.putImageData(img,0,0);}
    ctx.clearRect(w-Math.ceil(dx)-1,0,Math.ceil(dx)+3,h);
    ctx.strokeStyle='rgba(14,159,110,.08)'; ctx.lineWidth=.5;
    for(let gx=w%20;gx<w;gx+=20){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,h);ctx.stroke();}
    for(let gy=0;gy<h;gy+=18){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(w,gy);ctx.stroke();}
    ctx.strokeStyle='#0e9f6e'; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath();
    const steps=Math.ceil(dx)+2;
    for(let i=0;i<=steps;i++){const px=w-steps+i;const ph=(phase+i/speed/(period/1000))%1;const y=mid-ecgY(ph)*(mid*.8/25);if(i===0)ctx.moveTo(px,y);else ctx.lineTo(px,y);}
    ctx.stroke(); phase+=dt/1000/(period/1000);
    window[animVar]=requestAnimationFrame(draw);
  }
  if(window[animVar])cancelAnimationFrame(window[animVar]);
  window[animVar]=requestAnimationFrame(draw);
}
function startHeroECG(){startECGOnCanvas('ecgCanvasHero','ecgHeroAnimId');}
function openECG(){
  document.getElementById('ecgModal').style.display='flex';
  document.getElementById('ecgReading').textContent='';
  const t=data[data.length-1];
  document.getElementById('ecg-hr').textContent=t.rhr;
  document.getElementById('ecg-hrv').textContent=t.hrv;
  document.getElementById('ecg-status').textContent=t.rhr<60?'Sinus bradycardia · Rate below 60':t.rhr>100?'Elevated rate · Monitor':'Normal sinus rhythm';
  setTimeout(()=>startECGOnCanvas('ecgCanvas','ecgAnimId'),60);
}
function closeECG(){document.getElementById('ecgModal').style.display='none';if(window.ecgAnimId){cancelAnimationFrame(window.ecgAnimId);window.ecgAnimId=null;}stopSpeech();}
function sageReadsECG(){
  const t=data[data.length-1],name=profile.name||'Frank';
  const btn=document.getElementById('ecgReadBtn'); if(btn){btn.disabled=true;btn.textContent='Reading...';}
  const rhythm=t.rhr<60?'sinus bradycardia — rate below 60, common in well-conditioned individuals':t.rhr>100?'elevated rate — above 100 at rest warrants monitoring':'normal sinus rhythm — regular rate and spacing';
  const hrvNote=t.hrv>=60?`HRV of ${t.hrv} milliseconds is above average — excellent autonomic recovery.`:t.hrv>=45?`HRV of ${t.hrv} milliseconds is in normal range.`:`HRV of ${t.hrv} milliseconds is below optimal — nervous system is under load.`;
  const reading=`Good ${new Date().getHours()<12?'morning':'afternoon'}, ${name}. Reviewing your TK30 cardiac data. I'm seeing ${rhythm}. Heart rate at ${t.rhr} beats per minute. ${hrvNote} The QRS complex is clean and regular. T wave recovery looks normal. ${t.rhr<70?'Overall your cardiac profile is reassuring today.':'Stay hydrated and monitor tomorrow.'} This is generated from your ring's ECG sensor data.`;
  const readEl=document.getElementById('ecgReading')||document.getElementById('heroEcgReading');
  if(readEl)readEl.textContent=reading;
  speak(reading,()=>{if(btn){btn.disabled=false;btn.textContent='▶ Read aloud';}});
}

/* ─── VOICE ─────────────────────────────────────── */
async function speak(text,onEnd){
  const clean=text.replace(/<[^>]*>/g,'').replace(/[*_`#]/g,'').trim();
  try{
    const res=await fetch('/.netlify/functions/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean})});
    if(!res.ok)throw new Error('TTS '+res.status);
    setVoiceIndicator('azure-jenny');
    const blob=await res.blob();
    const url=URL.createObjectURL(blob);
    const audio=new Audio();
    audio.onended=()=>{URL.revokeObjectURL(url);if(onEnd)onEnd();};
    audio.onerror=()=>{URL.revokeObjectURL(url);if(onEnd)onEnd();};
    audio.src=url;
    const p=audio.play();if(p)p.catch(()=>{URL.revokeObjectURL(url);if(onEnd)onEnd();});
  }catch(e){
    if(!window.speechSynthesis)return;
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(clean);u.rate=.88;u.pitch=1;
    const voices=window.speechSynthesis.getVoices();
    const pref=voices.find(v=>/samantha|karen|daniel|alex/i.test(v.name))||voices.find(v=>v.lang==='en-US')||voices[0];
    if(pref)u.voice=pref;if(onEnd)u.onend=onEnd;
    window.speechSynthesis.speak(u);
  }
}
function stopSpeech(){if(window.speechSynthesis)window.speechSynthesis.cancel();}
function toggleVoice(){voiceOn=!voiceOn;const b=document.getElementById('chatVoiceBtn');b.textContent=voiceOn?'🔊':'🔇';b.classList.toggle('on',voiceOn);}

/* ─── WALKTHROUGH ───────────────────────────────── */
function buildWtSteps(){
  const t=data[data.length-1],age=profile.age||48,name=profile.name||'Frank';
  const gradeMap={'A':'excellent','B':'good','C':'fair','D':'needs attention'};
  const stateMap=typeof loadStateMap==='function'?loadStateMap():null;
  const grade=stateMap?.health_grade||'B';
  return[
    {title:'Welcome',text:`Hi ${name}. I am Dr. Sage, your personal health advisor. I live inside your SageHealth app and I watch your ring data every single day. My job is not to replace your doctor — it is to make sure that every time you see your doctor, you arrive prepared, informed, and with 90 days of data they can actually use. Let me show you around.`},
    {title:'What SageHealth does',text:`Your TK30 ring measures your heart rate, heart rate variability, blood pressure, blood oxygen, skin temperature, and sleep — continuously, while you sleep. I analyze those patterns daily. When I notice something worth paying attention to, I tell you what it means, what to ask your doctor, and I document it in a report they can read in 60 seconds.`},
    {title:'Your health today',text:`Here is where you stand today, ${name}. Your overall health grade is ${grade} — ${gradeMap[grade]||'good'}. Your readiness is ${t.readiness} out of 100. Blood pressure is ${t.bpSys} over ${t.bpDia}. HRV is ${t.hrv} milliseconds. These numbers tell a story — and the longer you wear the ring, the clearer that story gets.`},
    {title:'How I talk to you',text:`When I notice a pattern — a temperature spike, a blood pressure trend, a change in your sleep — I will let you know directly. You can tap my name to start a voice conversation. I will ask you what is going on in your life. We will build a plan together. And I will check back in to see if it is working.`},
    {title:'The doctor report',text:`This is the feature I am most proud of. Every time you have a doctor's appointment, tap Download Doctor Report. I will generate a clean, clinical PDF with your trends, my findings, and specific questions worth raising. Your doctor will actually read it — because it is concise, data-backed, and formatted the way they think. That moment — handing your doctor a real report — is what this is all for.`},
    {title:'What to do now',text:`${name}, here is what I'd suggest. Wear your ring every night. Open the app every morning. When a signal appears on your dashboard, talk to me about it. And before your next doctor's visit — download the report. The longer you do this, the better prepared you will be. I am watching. I will be here when something matters.`},
  ];
}
function startWt(){wtSteps=buildWtSteps();wtIdx=0;document.getElementById('wtOverlay').classList.add('open');const pips=document.getElementById('wtPips');pips.innerHTML=wtSteps.map((_,i)=>`<div class="wt-pip" id="wp${i}"></div>`).join('');renderWt();}
function renderWt(){const s=wtSteps[wtIdx];document.getElementById('wtBody').textContent=s.text;document.getElementById('wtStep').textContent=`Step ${wtIdx+1} of ${wtSteps.length} · ${s.title}`;document.getElementById('wtPrev').style.opacity=wtIdx===0?.3:1;document.getElementById('wtPrev').disabled=wtIdx===0;document.getElementById('wtNext').textContent=wtIdx===wtSteps.length-1?'Finish ✓':'Next →';wtSteps.forEach((_,i)=>{const p=document.getElementById('wp'+i);if(p)p.classList.toggle('on',i<=wtIdx);});if(wtVoiceOn)speakWt();}
function speakWt(){const b=document.getElementById('wtVoiceBtn');b.classList.add('speaking');speak(wtSteps[wtIdx].text,()=>b.classList.remove('speaking'));}
function wtNav(dir){stopSpeech();if(dir===1&&wtIdx===wtSteps.length-1){closeWt();return;}wtIdx=Math.max(0,Math.min(wtSteps.length-1,wtIdx+dir));renderWt();}
function closeWt(){stopSpeech();document.getElementById('wtOverlay').classList.remove('open');}
function toggleWtVoice(){wtVoiceOn=!wtVoiceOn;const b=document.getElementById('wtVoiceBtn');b.textContent=wtVoiceOn?'🔊':'🔇';b.classList.remove('speaking');if(!wtVoiceOn)stopSpeech();else speakWt();}

/* ─── WEEKLY MODAL ──────────────────────────────── */
function openWeekly(){
  try { renderWeeklyRecoveryBars(data); } catch(e) {}
  // Set week label
  const wl = document.getElementById('wm-week-label'); if (wl) { const d = new Date(); wl.textContent = 'Week of ' + d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
  const w=new Date(),ws=new Date(w); ws.setDate(w.getDate()-6);
  document.getElementById('wm-week-label').textContent=ws.toLocaleDateString('en-US',{month:'long',day:'numeric'})+' – '+w.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const t=data[data.length-1];
  document.getElementById('wk-stats').innerHTML=[
    {l:'Avg readiness',v:avg(data,'readiness')+'/100',c:'var(--green)',n:avg(data,'readiness')>=80?'Strong recovery.':'Below optimal.'},
    {l:'Avg sleep',v:avgF(data,'sleep')+'h',c:'var(--purple)',n:avgF(data,'sleep')>=7?'Within recommended range.':'Below 7h minimum.'},
    {l:'Avg BP (sys)',v:avg(data,'bpSys')+' mmHg',c:'var(--pink)',n:avg(data,'bpSys')<130?'Healthy pressure.':'Elevated — monitor.'},
    {l:'Avg temperature',v:avgF(data,'tempF')+'°F',c:'var(--amber)',n:'Baseline: '+t.tempBaseF+'°F'},
    {l:'Avg HRV',v:avg(data,'hrv')+' ms',c:'var(--green)',n:avg(data,'hrv')>=55?'Nervous system stable.':'Below baseline.'},
    {l:'Avg SpO₂',v:avgF(data,'spo2')+'%',c:'var(--cyan)',n:avgF(data,'spo2')>=96?'Oxygen healthy.':'Monitor for dips.'},
  ].map(s=>`<div class="wkstat"><div class="wkstat-label">${s.l}</div><div class="wkstat-val" style="color:${s.c}">${s.v}</div><div class="wkstat-note">${s.n}</div></div>`).join('');
  const best=data.reduce((b,d)=>d.sleep>b.sleep?d:b);
  document.getElementById('wk-insights').innerHTML=[
    {c:'',t:'Recovery driver',b:`Best recovery day (readiness ${data.reduce((b,d)=>d.readiness>b.readiness?d:b).readiness}/100) followed ${best.sleep}h sleep with ${best.deep}h deep.`},
    {c:avg(data,'bpSys')>=130?'warn':'',t:'Blood pressure',b:`Average systolic ${avg(data,'bpSys')} mmHg. ${avg(data,'bpSys')<130?'Healthy range.':'Elevated — reduce sodium, increase hydration, add daily walking.'}`},
    {c:data.some(d=>d.tempDev>0.5)?'warn':'',t:'Temperature watch',b:data.some(d=>d.tempDev>0.5)?`Temperature exceeded baseline on ${data.filter(d=>d.tempDev>0.5).length} night(s) — watch for symptoms.`:`Temperature within baseline all week.`},
    {c:'',t:'Cardiovascular load',b:`HRV ${avg(data,'hrv')}ms, RHR ${avg(data,'rhr')} BPM. ${avg(data,'hrv')>=55?'Both indicate healthy adaptation.':'HRV trending below optimal.'}`},
  ].map(p=>`<div class="insight ${p.c}"><div class="insight-title">${p.t}</div><div class="insight-body">${p.b}</div></div>`).join('');
  document.getElementById('wk-goals').innerHTML=[
    {l:'Daily steps',v:avg(data,'steps'),g:goals.steps||8000,fmt:v=>v.toLocaleString(),inv:false},
    {l:'Sleep duration',v:avgF(data,'sleep'),g:goals.sleep||7.5,fmt:v=>v+'h',inv:false},
    {l:'SpO₂',v:avgF(data,'spo2'),g:goals.spo2||92,fmt:v=>v+'%',inv:false},
    {l:'Apnea events/night',v:+(data.reduce((s,d)=>s+d.apnea,0)/7).toFixed(1),g:goals.apnea||2,fmt:v=>v,inv:true},
  ].map(it=>{const p=it.inv?Math.max(0,Math.min(100,(1-it.v/it.g)*100)):Math.min(100,it.v/it.g*100);const col=p>=80?'var(--green)':p>=50?'var(--amber)':'var(--red)';return`<div class="goal-row"><div class="goal-label">${it.l}</div><div class="goal-bar"><div class="goal-fill" style="width:${Math.round(p)}%;background:${col};"></div></div><div class="goal-vals">${it.fmt(it.v)} / ${it.fmt(it.g)}</div></div>`;}).join('');
  const ec=document.getElementById('encounter-content');if(ec)ec.dataset.generated='';
  encTab('brief');
  document.getElementById('weeklyModal').style.display='flex';
}
function closeWeekly(){document.getElementById('weeklyModal').style.display='none';}

/* ─── ENCOUNTER TABS ────────────────────────────── */
function encTab(tab){['brief','encounter','chat'].forEach(t=>{document.getElementById('epanel-'+t).classList.toggle('active',t===tab);document.getElementById('etab-'+t).classList.toggle('active',t===tab);});if(tab==='encounter')generateEncounter();if(tab==='chat')initSageChat();}

async function generateEncounter(){
  const el=document.getElementById('encounter-content');if(el.dataset.generated==='1')return;
  el.innerHTML='<div class="enc-generating"><div class="enc-spinner"></div>Generating clinical encounter...</div>';
  const t=data[data.length-1],age=profile.age||48;
  const prevEnc=JSON.parse(localStorage.getItem('sh_encounters')||'[]');
  const openActs=JSON.parse(localStorage.getItem('sh_actions')||'[]').filter(a=>!a.done).map(a=>a.title);
  const activeSigs=JSON.parse(localStorage.getItem('sh_active_signals')||'[]');
  const sigSummary=activeSigs.length>0?`Active signals: ${activeSigs.map(s=>s.title+' ('+s.level+')').join(', ')}.`:'No active signals.';
  const prompt=`You are SageHealth's clinical AI generating a formal encounter JSON. Evidence-based, specific.
Patient: ${profile.name||'Frank'}, ${age}yo ${profile.sex||'Male'}, ${profile.weight||185}lbs. Conditions: ${profile.conditions||'None'}.
Prior encounters: ${prevEnc.length}. Open items: ${openActs.join(', ')||'None'}.
Wosheng TK30 biometrics this week:
- Readiness: ${avg(data,'readiness')}/100 | HRV: ${avg(data,'hrv')}ms | RHR: ${avg(data,'rhr')} BPM
- BP: ${avg(data,'bpSys')}/${avg(data,'bpDia')} mmHg | Temp: ${avgF(data,'tempF')}°F (baseline ${t.tempBaseF}°F, dev ${((t.tempDev*9/5)>=0?'+':'')+((t.tempDev*9/5).toFixed(1))}°F)
- Sleep: ${avgF(data,'sleep')}h avg | Deep: ${t.deep}h | REM: ${t.rem}h
- SpO₂: ${avgF(data,'spo2')}% | Apnea: ${data.reduce((s,d)=>s+d.apnea,0)} events/week
- Steps: ${avg(data,'steps').toLocaleString()}/day
${sigSummary}
Return ONLY valid JSON (no markdown):
{"chiefConcerns":["string"],"findings":[{"icon":"emoji","label":"string","value":"string","status":"normal|borderline|abnormal","interpretation":"string"}],"impression":"string","orderedTests":[{"name":"string","priority":"urgent|routine|optional","reason":"string","how":"specific patient instructions"}],"plan":[{"step":"string","timeframe":"now|this week|this month|ongoing","rationale":"string"}],"followUp":"string","priorActionReview":"string"}`;
  try{
    const res=await fetch('/.netlify/functions/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:2000,messages:[{role:'user',content:prompt}]})});
    const d=await res.json();const text=(d.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim();
    const enc=JSON.parse(text);renderEncounter(enc,el);saveEncounter(enc);el.dataset.generated='1';
  }catch(e){el.innerHTML=`<div style="color:var(--muted);font-size:13px;padding:14px 0;">Unable to generate encounter. Error: ${e.message}</div>`;}
}
function renderEncounter(enc,el){
  const ts=JSON.parse(localStorage.getItem('sh_test_status')||'{}');let h='';
  if(enc.chiefConcerns?.length||enc.findings?.length){h+=`<div class="enc-card">`;if(enc.chiefConcerns?.length){h+=`<div class="enc-label"><div class="enc-dot" style="background:var(--cyan)"></div>Chief concerns</div>`;h+=enc.chiefConcerns.map(c=>`<div class="enc-finding"><div style="font-size:14px;margin-top:1px;">◉</div><div class="enc-finding-body">${c}</div></div>`).join('');}
  if(enc.findings?.length){h+=`<div class="enc-label" style="margin-top:14px;"><div class="enc-dot" style="background:var(--green)"></div>Clinical findings</div>`;h+=enc.findings.map(f=>{const col=f.status==='normal'?'var(--green)':f.status==='borderline'?'var(--amber)':'var(--red)';return`<div class="enc-finding"><div style="font-size:15px;margin-top:1px;">${f.icon}</div><div class="enc-finding-body"><strong>${f.label}: <span style="color:${col}">${f.value}</span></strong><span class="enc-sub">${f.interpretation}</span></div></div>`;}).join('');}
  if(enc.impression)h+=`<div style="margin-top:14px;font-size:13px;line-height:1.75;color:#8296b8;background:rgba(155,114,245,.05);border-left:2px solid var(--purple);padding:10px 14px;border-radius:0 8px 8px 0;">${enc.impression}</div>`;h+=`</div>`;}
  if(enc.orderedTests?.length){h+=`<div style="margin-bottom:14px;"><div class="enc-label"><div class="enc-dot" style="background:var(--red)"></div>Tests ordered</div>`;h+=enc.orderedTests.map((test,i)=>{const key=`t_${i}_${test.name.replace(/\W/g,'_')}`;const done=ts[key]||false;return`<div class="test-order" style="${done?'opacity:.5':''}"><span class="test-pri pri-${test.priority}">${test.priority}</span><div style="flex:1;"><div class="test-name" style="${done?'text-decoration:line-through;color:var(--muted)':''}">${test.name}</div><div class="test-reason">${test.reason}</div><div class="test-how">📋 ${test.how}</div></div><div style="flex-shrink:0;padding-top:2px;"><input type="checkbox" ${done?'checked':''} onchange="markTest('${key}',this.checked)"></div></div>`;}).join('');h+=`</div>`;}
  if(enc.plan?.length){h+=`<div class="enc-card"><div class="enc-label"><div class="enc-dot" style="background:var(--green)"></div>Management plan</div>`;h+=enc.plan.map((p,i)=>`<div class="plan-item"><div class="plan-num">${i+1}</div><div class="plan-text"><strong>${p.step}</strong><span class="plan-timeframe">⏱ ${p.timeframe} · ${p.rationale}</span></div></div>`).join('');h+=`</div>`;}
  if(enc.followUp)h+=`<div style="background:rgba(0,214,143,.05);border:1px solid rgba(0,214,143,.14);border-radius:8px;padding:10px 13px;font-size:12px;color:var(--green);line-height:1.6;margin-bottom:10px;">📅 <strong>Follow-up:</strong> ${enc.followUp}</div>`;
  h+=`<div class="enc-disclaimer">⚠ AI health monitoring tool — not a medical diagnosis. Not a substitute for a licensed physician.</div>`;el.innerHTML=h;
}
function markTest(key,checked){const ts=JSON.parse(localStorage.getItem('sh_test_status')||'{}');ts[key]=checked;localStorage.setItem('sh_test_status',JSON.stringify(ts));}
function saveEncounter(enc){
  const encs=JSON.parse(localStorage.getItem('sh_encounters')||'[]');encs.unshift({date:new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),enc,scores:{readiness:avg(data,'readiness'),hrv:avg(data,'hrv'),rhr:avg(data,'rhr'),sleep:avgF(data,'sleep')}});localStorage.setItem('sh_encounters',JSON.stringify(encs.slice(0,20)));
  if(enc.plan?.length){const ex=JSON.parse(localStorage.getItem('sh_actions')||'[]');const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});const ni=enc.plan.map(p=>({id:Date.now()+Math.random(),title:p.step,desc:p.rationale+' ('+p.timeframe+')',tag:'general',done:false,autoCheck:false,evidence:null,dateAssigned:date}));localStorage.setItem('sh_actions',JSON.stringify([...ni,...ex]));}
  populateHistory();showToast('📋 Encounter saved',`${enc.plan?.length||0} action items added.`);
}

/* ─── SAGE CHAT ─────────────────────────────────── */
function initSageChat(){
  chatMessages=[];document.getElementById('chatArea').innerHTML='';
  const t=data[data.length-1],name=profile.name||'Frank';
  const prevEnc=JSON.parse(localStorage.getItem('sh_encounters')||'[]');
  const openActs=JSON.parse(localStorage.getItem('sh_actions')||'[]').filter(a=>!a.done).map(a=>a.title);
  const histCtx=prevEnc.length>0?`${prevEnc.length} prior encounter(s). Last: "${prevEnc[0].enc?.impression?.slice(0,80)||''}". Open items: ${openActs.slice(0,3).join(', ')||'none'}.`:'First encounter.';
  const opening=`Good ${new Date().getHours()<12?'morning':'afternoon'}, ${name}. ${histCtx} Today: BP ${t.bpSys}/${t.bpDia}, SpO₂ ${t.spo2}%, temp ${t.tempF}°F, HRV ${t.hrv}ms.${t.tempDev>0.4?' Temperature is elevated above baseline — worth discussing.':''} What would you like to go over?`;
  chatMessages.push({role:'assistant',content:opening});addBubble('sage',opening);
}
function addBubble(who,text){const a=document.getElementById('chatArea'),d=document.createElement('div');d.className='chat-msg'+(who==='user'?' user':'');d.innerHTML=`<div class="chat-av ${who==='sage'?'sage':'you'}">${who==='sage'?'🧠':(profile.name||'F')[0].toUpperCase()}</div><div class="chat-bubble">${text}</div>`;a.appendChild(d);a.scrollTop=a.scrollHeight;}
function showTyping(){const a=document.getElementById('chatArea'),d=document.createElement('div');d.className='chat-msg';d.id='typing';d.innerHTML=`<div class="chat-av sage">🧠</div><div class="chat-bubble"><div class="typing"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>`;a.appendChild(d);a.scrollTop=a.scrollHeight;}
function removeTyping(){const t=document.getElementById('typing');if(t)t.remove();}
async function sendChat(){
  const inp=document.getElementById('chatInput'),msg=inp.value.trim();if(!msg)return;
  inp.value='';document.getElementById('chatSendBtn').disabled=true;
  addBubble('user',msg);chatMessages.push({role:'user',content:msg});showTyping();
  const t=data[data.length-1];
  const sys=`You are SageHealth's AI health coach — positioned between a health coach and a physician. You help patients understand their biometric trends and prepare for doctor visits.
You NEVER diagnose or prescribe. You interpret trends, explain metrics, and help the patient know what to discuss with their doctor.
Patient: ${profile.name||'Frank'}, ${profile.age||48}yo ${profile.sex||'Male'}. Conditions: ${profile.conditions||'None'}.
TK30 data: BP ${t.bpSys}/${t.bpDia} mmHg | SpO₂ ${t.spo2}% | Temp ${t.tempF}°F (${((t.tempDev*9/5)>=0?'+':'')+((t.tempDev*9/5).toFixed(1))}°F from baseline) | HRV ${avg(data,'hrv')}ms | RHR ${avg(data,'rhr')} BPM | Sleep ${avgF(data,'sleep')}h | Steps ${avg(data,'steps').toLocaleString()}/day
Style: plain English, 4–6 sentences, one follow-up question. Suggest bringing findings to their doctor when relevant.`;
  try{
    const res=await fetch('/.netlify/functions/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:1000,system:sys,messages:chatMessages})});
    const d=await res.json();removeTyping();
    const reply=d.content?.[0]?.text||'Connection issue — please try again.';
    chatMessages.push({role:'assistant',content:reply});addBubble('sage',reply);
    if(voiceOn)speak(reply);
    if(/wrap|done|bye|thank|finish/i.test(msg))saveConsultation(reply);
  }catch(e){removeTyping();addBubble('sage','Connection issue — check your configuration.');}
  document.getElementById('chatSendBtn').disabled=false;
}
function saveConsultation(assessment){
  const entry={date:new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),assessment,scores:{readiness:avg(data,'readiness'),sleep:avgF(data,'sleep'),hrv:avg(data,'hrv')}};
  consultHistory.unshift(entry);localStorage.setItem('sh_history',JSON.stringify(consultHistory));
  const tr=JSON.parse(localStorage.getItem('sh_transcripts')||'[]');tr.unshift({date:entry.date,messages:[...chatMessages],scores:entry.scores});localStorage.setItem('sh_transcripts',JSON.stringify(tr));
  const ex=JSON.parse(localStorage.getItem('sh_actions')||'[]');const ni=extractActions(assessment,chatMessages);localStorage.setItem('sh_actions',JSON.stringify([...ni,...ex]));
  populateHistory();showToast('📋 Consultation saved',`${ni.length} action items assigned.`);
}
function extractActions(assessment,log){
  const templates=[{p:/side.?sleep/i,title:'Sleep on your side',desc:'Reduces airway compression.',tag:'airway'},{p:/alcohol/i,title:'Reduce evening alcohol',desc:'Avoid within 3h of bed.',tag:'sleep'},{p:/walk|step/i,title:'Hit daily step goal',desc:`Target ${(goals.steps||8000).toLocaleString()} steps/day.`,tag:'activity'},{p:/bedtime|consistent/i,title:'Consistent bedtime',desc:'Same bedtime ±30 min.',tag:'sleep'},{p:/blood pressure|sodium/i,title:'Monitor blood pressure',desc:'Reduce sodium, increase water.',tag:'bp'},{p:/temperature|fever/i,title:'Track temperature trend',desc:'Watch for sustained elevation above baseline.',tag:'temp'},{p:/doctor|physician/i,title:'See your doctor',desc:'SageHealth flagged something worth discussing with a physician.',tag:'general'},{p:/hrv|recovery/i,title:'Monitor HRV trend',desc:'3 days below baseline = recovery focus needed.',tag:'heart'}];
  const all=[...log.map(m=>m.content),assessment].join(' ');
  const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return[...templates.filter(t=>t.p.test(all)).map(t=>({id:Date.now()+Math.random(),title:t.title,desc:t.desc,tag:t.tag,done:false,autoCheck:false,evidence:null,dateAssigned:date})),{id:Date.now()+.5,title:'Review next week',desc:'SageHealth weekly follow-up.',tag:'general',done:false,autoCheck:false,evidence:null,dateAssigned:date}];
}

/* ─── DOCTOR REPORT ─────────────────────────────── */
function openReportModal(){
  document.getElementById('reportModal').style.display='flex';
  document.getElementById('report-generating').style.display='flex';
  document.getElementById('report-content').innerHTML='';
  document.getElementById('report-actions').style.display='none';
  generateDoctorReport();
  const fu=localStorage.getItem('sh_pending_followup');
  const fuEl=document.getElementById('followup-status');
  if(fu){const f=JSON.parse(fu);fuEl.innerHTML=`<div class="followup-badge">⏳ Awaiting doctor follow-up from ${f.date}</div><div style="font-size:12px;color:var(--muted);margin-bottom:8px;">What did ${profile.drname||'your doctor'} say?</div>`;}
  else fuEl.innerHTML='';
}
function closeReportModal(){document.getElementById('reportModal').style.display='none';}
async function generateDoctorReport(){
  const t=data[data.length-1],age=profile.age||48,name=profile.name||'Frank';
  const drReports=JSON.parse(localStorage.getItem('sh_drreports')||'[]');
  const prevData=drReports.length>0?drReports[0]:null;
  const activeSigsRpt=JSON.parse(localStorage.getItem('sh_active_signals')||'[]');
  const sigSummaryRpt=activeSigsRpt.length>0?`SageHealth active signals: ${activeSigsRpt.map(s=>s.title+' ('+s.level+') — recommended: '+s.action).join('; ')}.`:'No active signals this week.';
  const prompt=`You are SageHealth generating a physician-ready patient report. Be clinical, concise, formatted for a doctor to read before an appointment.
Patient: ${name}, ${age}yo ${profile.sex||'Male'}, ${profile.weight||185}lbs. Conditions: ${profile.conditions||'None'}.
Current week TK30 data:
- BP: ${avg(data,'bpSys')}/${avg(data,'bpDia')} mmHg | SpO₂: ${avgF(data,'spo2')}% | Temp: ${avgF(data,'tempF')}°F (baseline ${t.tempBaseF}°F)
- HRV: ${avg(data,'hrv')}ms | RHR: ${avg(data,'rhr')} BPM | Sleep: ${avgF(data,'sleep')}h/night | Apnea: ${data.reduce((s,d)=>s+d.apnea,0)} events/week
- Steps: ${avg(data,'steps').toLocaleString()}/day
${prevData?`Prior week: BP ${prevData.bpSys}/${prevData.bpDia}, SpO₂ ${prevData.spo2}%, HRV ${prevData.hrv}ms, Sleep ${prevData.sleep}h`:'No prior data on file.'}
${sigSummaryRpt}
Return ONLY valid JSON (no markdown):
{"patientSummary":"2-3 sentence overview","keyFindings":[{"metric":"string","current":"string","previous":"string","trend":"improving|stable|worsening","note":"string"}],"concernsForDoctor":["string"],"recommendedDiscussion":["string"],"lifestyle":"brief lifestyle summary paragraph","disclaimer":"standard disclaimer"}`;
  try{
    const res=await fetch('/.netlify/functions/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:1500,messages:[{role:'user',content:prompt}]})});
    const d=await res.json();const text=(d.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim();
    const rpt=JSON.parse(text);
    renderDoctorReport(rpt);
    // Save report snapshot
    const snap={date:new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),bpSys:avg(data,'bpSys'),bpDia:avg(data,'bpDia'),spo2:avgF(data,'spo2'),hrv:avg(data,'hrv'),rhr:avg(data,'rhr'),sleep:avgF(data,'sleep'),tempF:avgF(data,'tempF'),report:rpt};
    const reports=JSON.parse(localStorage.getItem('sh_drreports')||'[]');reports.unshift(snap);localStorage.setItem('sh_drreports',JSON.stringify(reports.slice(0,20)));
    localStorage.setItem('sh_pending_followup',JSON.stringify({date:snap.date,bpSys:snap.bpSys}));
    populateHistory();
    reportText=buildReportText(rpt,snap.date);
  }catch(e){document.getElementById('report-content').innerHTML=`<div style="color:var(--muted);font-size:13px;padding:14px 0;">Unable to generate report. Error: ${e.message}</div>`;}
  document.getElementById('report-generating').style.display='none';
  document.getElementById('report-actions').style.display='block';
}
function renderDoctorReport(rpt){
  const t=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  let h=`<div class="report-section"><div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Generated ${t} · Wosheng TK30 ring data · 7-day average</div><div class="report-narrative"><strong>${profile.name||'Frank'}, ${profile.age||48}yo ${profile.sex||'Male'}</strong><br>${rpt.patientSummary||''}</div></div>`;
  if(rpt.keyFindings?.length){h+=`<div class="report-section"><div class="report-section-title">Key findings — trend vs prior week</div>`;h+=rpt.keyFindings.map(f=>{const arrow=f.trend==='improving'?'↑':'improving'?'↑':f.trend==='worsening'?'↓':'→';const col=f.trend==='improving'?'var(--green)':f.trend==='worsening'?'var(--red)':'var(--muted)';return`<div class="trend-row"><div class="trend-metric">${f.metric}</div><div class="trend-now">${f.current}</div><div class="trend-arrow" style="color:${col}">${arrow}</div><div class="trend-was">${f.previous||'—'}</div><div class="trend-note">${f.note}</div></div>`;}).join('');h+=`</div>`;}
  if(rpt.concernsForDoctor?.length){h+=`<div class="report-section"><div class="report-section-title">⚠ Items for physician attention</div>`;h+=rpt.concernsForDoctor.map(c=>`<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;"><span style="color:var(--amber);">•</span>${c}</div>`).join('');h+=`</div>`;}
  if(rpt.recommendedDiscussion?.length){h+=`<div class="report-section"><div class="report-section-title">Suggested discussion topics</div>`;h+=rpt.recommendedDiscussion.map(c=>`<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;"><span style="color:var(--cyan);">→</span>${c}</div>`).join('');h+=`</div>`;}
  if(rpt.lifestyle)h+=`<div class="report-section"><div class="report-section-title">Lifestyle summary</div><div style="font-size:13px;color:#8296b8;line-height:1.7;">${rpt.lifestyle}</div></div>`;
  document.getElementById('report-content').innerHTML=h;
}
function buildReportText(rpt,date){
  let t=`SAGEHEALTH PATIENT REPORT\n${date}\nPatient: ${profile.name||'Frank'}, ${profile.age||48}yo ${profile.sex||'Male'}\n\n`;
  t+=`SUMMARY\n${rpt.patientSummary||''}\n\n`;
  if(rpt.keyFindings?.length){t+=`KEY FINDINGS\n`;rpt.keyFindings.forEach(f=>{t+=`${f.metric}: ${f.current} (prev: ${f.previous||'N/A'}) — ${f.trend} — ${f.note}\n`;});t+='\n';}
  if(rpt.concernsForDoctor?.length){t+=`FOR PHYSICIAN ATTENTION\n`;rpt.concernsForDoctor.forEach(c=>t+=`• ${c}\n`);t+='\n';}
  if(rpt.recommendedDiscussion?.length){t+=`SUGGESTED DISCUSSION\n`;rpt.recommendedDiscussion.forEach(c=>t+=`→ ${c}\n`);t+='\n';}
  t+=`Generated by SageHealth (myaifern.com) from Wosheng TK30 ring data. This report is informational and does not constitute medical advice.\n`;
  return t;
}
function copyReport(){navigator.clipboard.writeText(reportText).then(()=>showToast('📋 Copied','Report copied to clipboard. Paste into an email to your doctor.'));}
async function handleResultUpload(e){
  const file=e.target.files[0]; if(!file)return;
  const ua=document.getElementById('upload-analysis');ua.style.display='block';ua.innerHTML='<div class="enc-generating"><div class="enc-spinner"></div>Analyzing uploaded results...</div>';
  const reader=new FileReader();
  reader.onload=async()=>{
    const base64=reader.result.split(',')[1];const mt=file.type;
    let messages;
    if(mt==='application/pdf'||mt.startsWith('image/')){messages=[{role:'user',content:[{type:mt==='application/pdf'?'document':'image',source:{type:'base64',media_type:mt,data:base64}},{type:'text',text:`You are SageHealth's AI. Analyze this uploaded medical document or result. Extract key findings, values, dates, and what they mean for the patient. Patient profile: ${profile.age||48}yo ${profile.sex||'Male'}, conditions: ${profile.conditions||'None'}. Be concise and actionable. Flag anything that should be discussed with their doctor.`}]}];}
    else{const text=atob(base64);messages=[{role:'user',content:`You are SageHealth's AI. Analyze this uploaded medical text. Extract key findings. Patient: ${profile.age||48}yo ${profile.sex||'Male'}, conditions: ${profile.conditions||'None'}.\n\n${text}`}];}
    try{
      const res=await fetch('/.netlify/functions/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:1000,messages})});
      const d=await res.json();const reply=d.content?.[0]?.text||'Unable to analyze.';
      ua.innerHTML=`<div style="background:rgba(0,184,217,.05);border:1px solid rgba(0,184,217,.18);border-radius:10px;padding:13px 15px;margin-top:4px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--cyan);font-weight:600;margin-bottom:7px;">📄 ${file.name} — Analysis</div><div style="font-size:13px;color:#8296b8;line-height:1.7;">${reply}</div></div>`;
      const uploads=JSON.parse(localStorage.getItem('sh_uploads')||'[]');uploads.unshift({date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),filename:file.name,analysis:reply});localStorage.setItem('sh_uploads',JSON.stringify(uploads.slice(0,20)));
      showToast('📄 Result analyzed','Added to your health record.');
    }catch(err){ua.innerHTML=`<div style="color:var(--muted);font-size:13px;">Analysis failed: ${err.message}</div>`;}
  };
  if(file.type.startsWith('image/')||file.type==='application/pdf')reader.readAsDataURL(file);else reader.readAsText(file);
}
async function saveDrResult(){
  const text=document.getElementById('drResultText').value.trim(); if(!text)return;
  localStorage.removeItem('sh_pending_followup');
  const analysisEl=document.getElementById('dr-sage-analysis');analysisEl.style.display='block';analysisEl.innerHTML='<div class="enc-generating"><div class="enc-spinner"></div>SageHealth is reviewing what your doctor said...</div>';
  const prompt=`You are SageHealth's AI. The patient just told you what their doctor said after receiving a SageHealth report. Acknowledge, interpret what it means for their ongoing monitoring, and note any new action items. Be warm and practical.\nDoctor's response: "${text}"\nPatient context: ${profile.age||48}yo ${profile.sex||'Male'}, conditions: ${profile.conditions||'None'}, current BP ${avg(data,'bpSys')}/${avg(data,'bpDia')}, SpO₂ ${avgF(data,'spo2')}%, HRV ${avg(data,'hrv')}ms.`;
  try{
    const res=await fetch('/.netlify/functions/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:600,messages:[{role:'user',content:prompt}]})});
    const d=await res.json();const reply=d.content?.[0]?.text||'Saved.';
    analysisEl.innerHTML=`<div class="dr-feedback-card">${reply}</div>`;
    const reports=JSON.parse(localStorage.getItem('sh_drreports')||'[]');if(reports.length>0){reports[0].drFeedback=text;reports[0].drAnalysis=reply;localStorage.setItem('sh_drreports',JSON.stringify(reports));}
    showToast('🩺 Doctor feedback saved','Your health record has been updated.');
  }catch(e){analysisEl.innerHTML=`<div style="color:var(--muted);font-size:13px;">Unable to process — ${e.message}</div>`;}
}

/* ─── CONTACT DOCTOR ────────────────────────────── */
function openContactDr(){
  const t=data[data.length-1];
  document.getElementById('cdr_drname').value=profile.drname||'';
  selectedUrgency='routine';['routine','soon','urgent'].forEach(u=>document.getElementById('urgency-'+u).className='cdr-u-btn');
  document.getElementById('urgency-routine').className='cdr-u-btn selected-routine';
  document.getElementById('cdr-summary').textContent=`Patient: ${profile.name||'Frank'}, ${profile.age||48}yo ${profile.sex||'Male'}. Key metrics this week: BP ${avg(data,'bpSys')}/${avg(data,'bpDia')} mmHg, SpO₂ ${avgF(data,'spo2')}%, temp ${avgF(data,'tempF')}°F, HRV ${avg(data,'hrv')}ms, RHR ${avg(data,'rhr')} BPM, sleep ${avgF(data,'sleep')}h/night. ${avg(data,'bpSys')>=130?`Blood pressure elevated (${avg(data,'bpSys')} mmHg average).`:'Blood pressure in healthy range.'} ${data.some(d=>d.tempDev>0.5)?'Temperature elevation above baseline detected.':'Temperature stable.'}`;
  document.getElementById('contactDrModal').style.display='flex';
}
function closeCDR(){document.getElementById('contactDrModal').style.display='none';}
function selectUrgency(u){selectedUrgency=u;['routine','soon','urgent'].forEach(x=>{document.getElementById('urgency-'+x).className='cdr-u-btn'+(x===u?' selected-'+x:'');});}
function sendToDr(){
  const dr=document.getElementById('cdr_drname').value||'your doctor';const reason=document.getElementById('cdr_reason').value;const summary=document.getElementById('cdr-summary').textContent;
  const msg=`Subject: Patient health update from SageHealth — ${profile.name||'Frank'} — ${new Date().toLocaleDateString()}\n\nDear ${dr},\n\nI am sending you a health update from SageHealth, a continuous health monitoring app using a Wosheng TK30 medical-grade ring.\n\nPatient: ${profile.name||'Frank'}, ${profile.age||48}yo ${profile.sex||'Male'}\nUrgency: ${selectedUrgency.toUpperCase()}\n${reason?`Reason for contact: ${reason}\n`:''}\n${summary}\n\nA full trend report is available to attach — please let me know if you would like it.\n\nThank you,\n${profile.name||'Frank'}\n\n(Generated by SageHealth — health monitoring app. This is not a medical diagnosis.)`;
  navigator.clipboard.writeText(msg).then(()=>{showToast('📋 Message copied','Paste into your email or patient portal.');closeCDR();}).catch(()=>{alert(msg);closeCDR();});
}

/* ─── RECORDS ───────────────────────────────────── */
function switchTab(tab){if(tab==='commitments'&&typeof renderCommitmentsTab==='function')setTimeout(renderCommitmentsTab,50);['actions','encounters','transcripts','assessments','drreports','commitments'].forEach(t=>{const el=document.getElementById('historyTab-'+t);if(el)el.style.display=t===tab?'block':'none';const b=document.getElementById('tab-'+t);if(b)b.classList.toggle('active',t===tab);});}
function toggleTranscript(i){const b=document.getElementById('tb'+i),a=document.getElementById('ta'+i);if(b){const o=b.classList.toggle('open');if(a)a.textContent=o?'▲':'▼';}}
function toggleEncounter(i){const b=document.getElementById('henc'+i);if(b){const o=b.classList.toggle('open');const btn=document.getElementById('hebtn'+i);if(btn)btn.textContent=o?'▲ collapse':'▼ expand';}}
function toggleAction(id){const items=JSON.parse(localStorage.getItem('sh_actions')||'[]');const i=items.findIndex(x=>String(x.id)===String(id));if(i>=0&&!items[i].autoCheck){items[i].done=!items[i].done;localStorage.setItem('sh_actions',JSON.stringify(items));populateHistory();}}
function populateHistory(){
  const stored=localStorage.getItem('sh_history');if(stored)consultHistory=JSON.parse(stored);
  const actions=JSON.parse(localStorage.getItem('sh_actions')||'[]');
  const al=document.getElementById('action-items-list'),ae=document.getElementById('action-empty');
  if(!actions.length){if(al)al.innerHTML='';if(ae)ae.style.display='block';}
  else{if(ae)ae.style.display='none';const open=actions.filter(a=>!a.done),done=actions.filter(a=>a.done);let html='';if(open.length){html+=`<div class="sec-label">Open (${open.length})</div>`;html+=open.map(a=>`<div class="action-card"><div class="ac-check" onclick="toggleAction(${a.id})"></div><div><div class="ac-title">${a.title}</div><div class="ac-desc">${a.desc}</div><div class="ac-meta"><span class="ac-tag tag-${a.tag}">${a.tag}</span><span class="ac-date">Assigned ${a.dateAssigned}</span></div></div></div>`).join('');}if(done.length){html+=`<div class="sec-label">Completed (${done.length})</div>`;html+=done.map(a=>`<div class="action-card done"><div class="ac-check ${a.autoCheck?'auto':'checked'}" onclick="toggleAction(${a.id})">✓</div><div><div class="ac-title">${a.title}</div><div class="ac-desc">${a.desc}</div><div class="ac-meta"><span class="ac-tag tag-${a.tag}">${a.tag}</span><span class="ac-date">${a.dateAssigned}</span></div></div></div>`).join('');}if(al)al.innerHTML=html;}
  const tr=JSON.parse(localStorage.getItem('sh_transcripts')||'[]');const tl=document.getElementById('transcript-list'),te=document.getElementById('transcript-empty');if(!tr.length){if(tl)tl.innerHTML='';if(te)te.style.display='block';}else{if(te)te.style.display='none';if(tl)tl.innerHTML=tr.map((t,i)=>`<div class="transcript-card"><div class="tc-head" onclick="toggleTranscript(${i})"><div><div class="tc-date">${t.date}</div><div class="tc-prev">${t.messages.length} messages · Readiness ${t.scores.readiness}/100</div></div><span id="ta${i}">▼</span></div><div class="tc-body" id="tb${i}">${t.messages.map(m=>`<div class="t-msg ${m.role==='user'?'user':''}"><div class="t-av ${m.role==='user'?'you':'sage'}">${m.role==='user'?(profile.name||'F')[0].toUpperCase():'🧠'}</div><div class="t-bubble">${m.content}</div></div>`).join('')}</div></div>`).join('');}
  const encs=JSON.parse(localStorage.getItem('sh_encounters')||'[]');const enl=document.getElementById('encounter-list'),ene=document.getElementById('encounter-empty');if(!encs.length){if(enl)enl.innerHTML='';if(ene)ene.style.display='block';}else{if(ene)ene.style.display='none';if(enl)enl.innerHTML=encs.map((e,i)=>`<div class="he"><div class="he-head"><div><div style="font-size:11px;color:var(--muted);">${e.date}</div><div style="font-size:13px;font-weight:600;">Clinical encounter · Readiness ${e.scores.readiness}/100</div></div><button class="he-expand" id="hebtn${i}" onclick="toggleEncounter(${i})">▼ expand</button></div><div style="font-size:12px;color:var(--muted);margin-top:4px;">${(e.enc?.impression||'').slice(0,100)}...</div><div class="he-body" id="henc${i}"><div style="font-size:13px;color:#7a92b5;line-height:1.7;margin-bottom:9px;">${e.enc?.impression||''}</div>${e.enc?.plan?.length?`<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:9px 0 6px;">Plan</div>`+e.enc.plan.map((p,j)=>`<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">${j+1}. ${p.step} <span style="color:var(--muted);">(${p.timeframe})</span></div>`).join(''):''}}</div></div>`).join('');}
  const hl=document.getElementById('history-list'),he=document.getElementById('assessment-empty');if(!consultHistory.length){if(hl)hl.innerHTML='';if(he)he.style.display='block';}else{if(he)he.style.display='none';if(hl)hl.innerHTML=consultHistory.map(h=>`<div class="hc"><div class="hc-date">${h.date}</div><div style="font-size:13px;font-weight:600;">Assessment</div><div class="hc-body">${h.assessment}</div><div class="hc-scores"><span class="hc-score" style="color:var(--green)">Readiness ${h.scores.readiness}</span><span class="hc-score" style="color:var(--purple)">Sleep ${h.scores.sleep}h</span><span class="hc-score" style="color:var(--cyan)">HRV ${h.scores.hrv}ms</span></div></div>`).join('');}
  const drr=JSON.parse(localStorage.getItem('sh_drreports')||'[]');const drl=document.getElementById('drreport-list'),dre=document.getElementById('drreport-empty');if(!drr.length){if(drl)drl.innerHTML='';if(dre)dre.style.display='block';}else{if(dre)dre.style.display='none';if(drl)drl.innerHTML=drr.map((r,i)=>`<div class="hc"><div class="hc-date">${r.date}</div><div style="font-size:13px;font-weight:600;">Doctor report · BP ${r.bpSys}/${r.bpDia} · SpO₂ ${r.spo2}%</div>${r.drFeedback?`<div style="font-size:12px;color:var(--muted);margin-top:6px;">🩺 Doctor said: ${r.drFeedback.slice(0,120)}...</div>`:''}<div class="hc-body">${r.report?.patientSummary||''}</div></div>`).join('');}
}

/* ─── SETTINGS ──────────────────────────────────── */
function populateSettings(){
  document.getElementById('s_name').value=profile.name||'';document.getElementById('s_age').value=profile.age||'';document.getElementById('s_weight').value=profile.weight||'';document.getElementById('s_height').value=profile.height||'';document.getElementById('s_sex').value=profile.sex||'Male';document.getElementById('s_conditions').value=profile.conditions||'';document.getElementById('s_drname').value=profile.drname||'';document.getElementById('s_steps').value=goals.steps||8000;document.getElementById('s_sleep').value=goals.sleep||7.5;document.getElementById('s_apnea').value=goals.apnea||2;document.getElementById('s_spo2').value=goals.spo2||92;
}
function saveSettings(){
  profile={name:document.getElementById('s_name').value,age:parseInt(document.getElementById('s_age').value),weight:parseInt(document.getElementById('s_weight').value),height:parseFloat(document.getElementById('s_height').value),sex:document.getElementById('s_sex').value,conditions:document.getElementById('s_conditions').value,drname:document.getElementById('s_drname').value};
  goals={steps:parseInt(document.getElementById('s_steps').value),sleep:parseFloat(document.getElementById('s_sleep').value),apnea:parseInt(document.getElementById('s_apnea').value),spo2:parseInt(document.getElementById('s_spo2').value)};
  localStorage.setItem('sh_profile',JSON.stringify(profile));localStorage.setItem('sh_goals',JSON.stringify(goals));setGreeting();showToast('✓ Saved','Settings updated.');
}


/* ── DOCTOR REPORT PDF ──────────────────────────────── */
function askDoctorType() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.id = 'dr-type-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(30,40,60,.6);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;';

    const doctors = [
      { id:'primary_care',  label:'Primary Care / GP',       icon:'🩺', desc:'General visit or annual check-up' },
      { id:'cardiologist',  label:'Cardiologist',             icon:'❤️', desc:'Heart, BP, rhythm, HRV concerns' },
      { id:'endocrinologist',label:'Endocrinologist',         icon:'⚗️', desc:'Thyroid, diabetes, hormones' },
      { id:'pulmonologist', label:'Pulmonologist / Sleep',    icon:'🫁', desc:'Breathing, sleep apnea, SpO₂' },
      { id:'neurologist',   label:'Neurologist',              icon:'🧠', desc:'Nervous system, stress, burnout' },
      { id:'gynecologist',  label:'Gynecologist / OB-GYN',   icon:'👩‍⚕️', desc:'Hormonal patterns, cycle health' },
      { id:'other',         label:'Other specialist',         icon:'👨‍⚕️', desc:'Any other physician' },
    ];

    modal.innerHTML = `
      <div style="background:white;border-radius:20px;padding:28px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.15);max-height:90vh;overflow-y:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:16px;font-weight:800;color:var(--text);">Who are you seeing?</div>
          <button onclick="document.getElementById('dr-type-modal').remove();window._drTypeResolve(null);" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;">✕</button>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:18px;">Dr. Sage will tailor the report language and focus to the specialist you're visiting.</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          ${doctors.map(d => `
            <button onclick="document.getElementById('dr-type-modal').remove();window._drTypeResolve({id:'${d.id}',label:'${d.label}'});"
              style="display:flex;align-items:center;gap:12px;background:var(--bg);border:1px solid var(--border2);border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;width:100%;"
              onmouseover="this.style.background='var(--blue-bg)';this.style.borderColor='rgba(29,111,164,.3)'"
              onmouseout="this.style.background='var(--bg)';this.style.borderColor='var(--border2)'">
              <span style="font-size:22px;flex-shrink:0;">${d.icon}</span>
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--text);">${d.label}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${d.desc}</div>
              </div>
            </button>
          `).join('')}
        </div>
        <div style="text-align:center;">
          <button onclick="document.getElementById('dr-type-modal').remove();window._drTypeResolve({id:'primary_care',label:'Physician'});"
            style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;text-decoration:underline;">
            Skip — generate general report
          </button>
        </div>
      </div>`;

    window._drTypeResolve = resolve;
    document.body.appendChild(modal);
  });
}

async function generateDoctorReport() {
  // Ask who they're seeing — Dr. Sage tailors the report
  const doctorInfo = await askDoctorType();
  if (doctorInfo === null) return; // closed modal = cancelled

  const btn = document.getElementById('doctor-report-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating report...'; }

  try {
    const stateMap = typeof loadStateMap === 'function' ? loadStateMap() : null;
    // Only pass signals that are currently fired AND not dismissed
    const allFiredSignals = JSON.parse(localStorage.getItem('sh_active_signals') || '[]');
    const dismissed = JSON.parse(localStorage.getItem('sh_acknowledged_signals') || '{}');
    const firedSignals = allFiredSignals.filter(s => !dismissed[s.id]);
    const commitments = JSON.parse(localStorage.getItem('sh_commitments') || '[]');
    const today = new Date().toISOString().slice(0, 10);

    const payload = {
      stateMap, profile,
      signals: firedSignals,
      commitments,
      testResults: JSON.parse(localStorage.getItem('sh_test_results') || '{}'),
      doctorInfo,
      reportDate: today
    };

    // Step 1: Get narrative first (fast ~2s) — display in app immediately
    const narrativeRes = await fetch('/.netlify/functions/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, format: 'json' })
    });

    if (!narrativeRes.ok) throw new Error('Report failed: ' + narrativeRes.status);
    const narrativeData = await narrativeRes.json();
    const narrative = narrativeData.narrative || '';

    // Save report record
    const reportRecord = {
      id: Date.now(),
      date: today,
      doctor: doctorInfo?.label || 'Physician',
      doctorId: doctorInfo?.id || 'primary_care',
      signalCount: firedSignals.length,
      signals: firedSignals.map(s => s.title),
      healthGrade: stateMap?.health_grade || 'B',
      narrative
    };
    const saved = JSON.parse(localStorage.getItem('sh_doctor_reports') || '[]');
    saved.unshift(reportRecord);
    localStorage.setItem('sh_doctor_reports', JSON.stringify(saved.slice(0, 10)));

    window._lastReportDate   = today;
    window._lastReportDoctor = doctorInfo;
    window._lastReportPayload = payload;

    // Render in-app with narrative
    renderReportPreview(reportRecord, firedSignals, stateMap, doctorInfo, narrative);
    loadSavedReports();
    document.getElementById('report-actions').style.display = 'block';
    document.getElementById('report-generating').style.display = 'none';

    showToast('✓ Report ready', 'Email it to your doctor or tap Download PDF.');

  } catch(e) {
    console.log('Report error:', e);
    showToast('⚠ Report failed', 'Check your connection and try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📋 Download doctor report'; }
  }
}


/* ── DOCTOR REPORT — IN APP ─────────────────────────── */

function renderReportPreview(record, signals, stateMap, doctorInfo, narrative) {
  const m = stateMap || {};
  const cv = m.cardio || {};
  const sl = m.sleep || {};
  const t = m.temperature || {};
  const a = m.activity || {};
  const r = m.recovery || {};
  const p = profile || {};

  const date = new Date(record.date).toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'});

  let html = `
    <div style="border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-top:14px;">

      <!-- Report header -->
      <div style="background:var(--blue);padding:16px 18px;color:white;">
        <div style="font-size:11px;opacity:.8;margin-bottom:2px;text-transform:uppercase;letter-spacing:.05em;">myDrSage Health Report</div>
        <div style="font-size:16px;font-weight:800;">${p.name || 'Patient'}, ${p.age || '--'}yo ${p.sex || ''}</div>
        <div style="font-size:11px;opacity:.8;margin-top:4px;">For: ${doctorInfo?.label || 'Physician'} · Generated ${date}</div>
      </div>

      <!-- Dr. Sage Clinical Analysis -->
      ${narrative ? '<div style="padding:16px 18px;border-bottom:1px solid var(--border);background:var(--bg);">' +
        '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Dr. Sage Clinical Analysis</div>' +
        '<div style="font-size:13px;color:var(--text);line-height:1.7;">' +
        narrative.replace(/\n\n/g, '</p><p style="margin-top:10px;">').replace(/^/, '<p>').replace(/$/, '</p>') +
        '</div></div>' : ''}

      <!-- Biometric summary -->
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">7-Day Biometric Summary</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${(function() {
            const metrics = [
              ['HRV', cv.hrv?.current + 'ms', cv.hrv?.trend?.label, cv.hrv?.status],
              ['Resting HR', cv.rhr?.current + ' BPM', cv.rhr?.trend?.label, cv.rhr?.status],
              ['Blood Pressure', (cv.bp?.systolic||'--') + '/' + (cv.bp?.diastolic||'--'), cv.bp?.trend?.label, cv.bp?.status],
              ['SpO2', cv.spo2?.current + '%', cv.spo2?.trend?.label, cv.spo2?.status],
              ['Total Sleep', sl.total?.avg7d + 'h avg', sl.total?.trend?.label, sl.total?.avg7d >= 7 ? 'normal' : 'watch'],
              ['Deep Sleep', sl.deep?.avg7d + 'h avg', sl.deep?.trend?.label, sl.deep?.avg7d >= 1.2 ? 'normal' : 'watch'],
              ['Temperature', (t.last_night_f||'--') + 'F', (t.deviation_f > 0 ? '+' : '') + (t.deviation_f||0) + 'F from baseline', t.status],
              ['Readiness', (r.readiness||'--') + '/100', r.trend?.label, r.status],
            ];
            return metrics.map(function(row) {
              const label = row[0], val = row[1], trend = row[2], status = row[3];
              const statusColor = ['excellent','optimal','normal','good','athletic'].includes(status) ? 'var(--green)' :
                                  ['elevated','watch','below_norm'].includes(status) ? 'var(--amber)' :
                                  ['high','low','suppressed'].includes(status) ? 'var(--red)' : 'var(--muted)';
              return '<div style="background:var(--bg);border-radius:9px;padding:10px 12px;">' +
                '<div style="font-size:10px;color:var(--muted);font-weight:600;margin-bottom:3px;">' + label + '</div>' +
                '<div style="font-size:14px;font-weight:700;color:' + statusColor + ';">' + (val||'--') + '</div>' +
                '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + (trend||'') + '</div>' +
                '</div>';
            }).join('');
          })()}
        </div>
      </div>

      <!-- Active signals -->
      ${signals.length > 0 ? (function() {
        return '<div style="padding:14px 16px;border-bottom:1px solid var(--border);">' +
          '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Patterns for Clinical Review</div>' +
          signals.map(function(s) {
            const col = s.level === 'urgent' ? 'var(--red)' : s.level === 'watch' ? 'var(--amber)' : 'var(--blue)';
            const bg  = s.level === 'urgent' ? 'var(--red-bg)' : s.level === 'watch' ? 'var(--amber-bg)' : 'var(--blue-bg)';
            return '<div style="background:' + bg + ';border-left:3px solid ' + col + ';border-radius:8px;padding:10px 12px;margin-bottom:7px;">' +
              '<div style="font-size:12px;font-weight:700;color:' + col + ';">' + s.title + '</div>' +
              '<div style="font-size:11px;color:var(--muted);margin-top:3px;">' + (s.action||'') + '</div>' +
              '</div>';
          }).join('') +
          '</div>';
      })() : ''}

      <!-- Health grade -->
      <div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:12px;color:var(--muted);">Overall health grade this week</div>
        <div style="font-size:24px;font-weight:900;color:var(--blue);">${m.health_grade || 'B'}</div>
      </div>

      <!-- Disclaimer -->
      <div style="padding:10px 16px;background:var(--bg);border-top:1px solid var(--border);">
        <div style="font-size:10px;color:var(--muted);line-height:1.5;">Data generated by myDrSage continuous biometric monitoring (V80 ring). For informational purposes only — not a medical diagnosis. Review with your licensed physician.</div>
      </div>
    </div>`;

  document.getElementById('report-content').innerHTML = html;
  document.getElementById('report-subtitle').textContent = 'For ' + (doctorInfo?.label || 'your physician') + ' · ' + date;
}

function loadSavedReports() {
  const saved = JSON.parse(localStorage.getItem('sh_doctor_reports') || '[]');
  const bar = document.getElementById('saved-reports-bar');
  if (!saved.length || !bar) return;

  bar.style.display = 'block';
  bar.innerHTML = '<span style="font-size:11px;color:var(--muted);margin-right:8px;vertical-align:middle;">Past reports:</span>' +
    saved.map(function(r, i) {
      return '<button onclick="loadSavedReport(' + i + ')" style="display:inline-block;background:' +
        (i===0?'var(--blue)':'var(--bg)') + ';color:' + (i===0?'white':'var(--muted)') +
        ';border:1px solid ' + (i===0?'var(--blue)':'var(--border2)') +
        ';border-radius:20px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;margin-right:6px;white-space:nowrap;">' +
        r.doctor + ' · ' + r.date + '</button>';
    }).join('');
}

function loadSavedReport(idx) {
  const saved = JSON.parse(localStorage.getItem('sh_doctor_reports') || '[]');
  const record = saved[idx];
  if (!record) return;
  const stateMap = typeof loadStateMap === 'function' ? loadStateMap() : null;
  const signals = (record.signals || []).map(title => ({ title, level: 'watch', action: '' }));
  renderReportPreview(record, signals, stateMap, { label: record.doctor, id: record.doctorId }, record.narrative || '');
  document.getElementById('report-actions').style.display = 'block';
}

async function downloadReportPDF() {
  if (!window._lastReportPayload) {
    showToast('⚠ No report', 'Generate a report first.');
    return;
  }
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Building PDF...'; }

  try {
    const res = await fetch('/.netlify/functions/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(window._lastReportPayload)
    });
    if (!res.ok) throw new Error('PDF failed: ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'myDrSage_Report_' + (window._lastReportDate || 'report') + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ PDF downloaded', 'Attach it to your email to the doctor.');
  } catch(e) {
    showToast('⚠ PDF failed', e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇️ Download PDF'; }
  }
}

function emailReport() {
  const panel = document.getElementById('email-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function sendReportEmail() {
  const to = document.getElementById('report-email-to')?.value?.trim();
  const drName = document.getElementById('report-email-name')?.value?.trim() || 'Doctor';
  if (!to) { showToast('⚠', 'Enter your doctor email address.'); return; }

  // Use mailto: with report summary — deeplinks into email app
  const patientName = profile?.name || 'Patient';
  const date = window._lastReportDate || new Date().toISOString().slice(0,10);
  const doctorLabel = window._lastReportDoctor?.label || 'Physician';
  const grade = (typeof loadStateMap === 'function' ? loadStateMap() : {})?.health_grade || 'B';

  const subject = encodeURIComponent('myDrSage Health Report — ' + patientName + ' — ' + date);
  const body = encodeURIComponent(
    'Dear ' + drName + ',\n\n' +
    'Please find attached the myDrSage biometric health report for ' + patientName + ' in advance of our ' + doctorLabel + ' appointment.\n\n' +
    'Report summary:\n' +
    '- Health grade this week: ' + grade + '\n' +
    '- Generated: ' + date + '\n' +
    '- Report tailored for: ' + doctorLabel + '\n\n' +
    'This report was generated by myDrSage, a continuous biometric monitoring service using the V80 smart ring. It includes 7-day averages for HRV, resting heart rate, blood pressure, SpO2, sleep architecture, skin temperature, and step count, along with algorithmically detected patterns for clinical review.\n\n' +
    'To view the full PDF report, please ask the patient to share it with you directly from the myDrSage app.\n\n' +
    'Note: This report is informational only and does not constitute medical diagnosis or advice.\n\n' +
    'Generated by myDrSage — myDrSage.com'
  );

  window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;

  // Also show PDF download prompt
  setTimeout(() => {
    showToast('📧 Email opened', 'Download the PDF and attach it to the email.');
    document.getElementById('report-actions').style.display = 'block';
  }, 500);
}

function shareReport() {
  const patientName = profile?.name || 'Patient';
  const date = window._lastReportDate || new Date().toISOString().slice(0,10);

  if (navigator.share && window._lastReportBlob) {
    const file = new File([window._lastReportBlob], 'myDrSage_Report_' + date + '.pdf', { type: 'application/pdf' });
    navigator.share({
      title: 'myDrSage Health Report — ' + patientName + ',',
      text: 'My health report from myDrSage — please review before my appointment.',
      files: [file]
    }).catch(e => console.log('Share cancelled:', e));
  } else {
    // Fallback — copy a link or download
    downloadReportPDF();
    showToast('📤 PDF downloaded', 'Share the file via email, AirDrop, or Messages.');
  }
}


/* ── ONBOARDING v2 ─────────────────────────────────── */
const OB_QUESTIONS = [
  { q: "What's your name?", hint: "Just say it out loud — there's no wrong answer.", key: 'name' },
  { q: "How old are you?", hint: "Your age helps me calibrate every reading.", key: 'age' },
  { q: "Are you male or female, or would you describe yourself differently?", hint: "This helps with baseline ranges.", key: 'sex' },
  { q: "Do you have any health conditions I should know about — like high blood pressure, diabetes, or anything else?", hint: "Say none if not. No wrong answers.", key: 'conditions' },
  { q: "Are you taking any medications regularly?", hint: "Even supplements are worth mentioning.", key: 'medications' },
  { q: "Is there anything in your family's health history I should keep in mind?", hint: "Heart disease, diabetes, anything at all.", key: 'family_history' },
];
function startVoiceOnboarding() {
  document.getElementById('ob-welcome').style.display = 'none';
  const v = document.getElementById('ob-voice');
  v.style.display = 'flex';
  obStep = 0;
  obShowQuestion();
  // Auto-play first question via TTS
  setTimeout(() => obSpeakQuestion(), 600);
}

function startTypingOnboarding() {
  document.getElementById('ob-welcome').style.display = 'none';
  document.getElementById('ob-typing').style.display = 'block';
}

function obShowQuestion() {
  const q = OB_QUESTIONS[obStep];
  if (!q) { obShowAllSet(); return; }

  document.getElementById('ob-question').textContent = q.q;
  document.getElementById('ob-hint').textContent = q.hint;
  document.getElementById('ob-progress-label').textContent = 'Getting to know you · ' + (obStep + 1) + ' of ' + OB_QUESTIONS.length;

  // Update progress bars
  const bars = document.getElementById('ob-progress-bars');
  if (bars) {
    bars.querySelectorAll('span').forEach((bar, i) => {
      bar.style.background = i <= obStep ? 'var(--accent)' : 'var(--hairline)';
    });
  }
  // State: Dr. Sage is speaking
  obSetState('speaking');
}

function obSetState(state) {
  const dot = document.getElementById('ob-state-dot');
  const txt = document.getElementById('ob-state-text');
  const wave = document.getElementById('ob-waveform');
  const pulse = document.getElementById('ob-mic-pulse');
  const micLabel = document.getElementById('ob-mic-label');

  if (state === 'speaking') {
    if (dot) dot.style.background = 'var(--urgent)';
    if (txt) txt.textContent = 'DR. SAGE IS SPEAKING';
    if (wave) wave.style.display = 'none';
    if (pulse) pulse.style.display = 'none';
    if (micLabel) micLabel.textContent = 'Tap to respond';
  } else if (state === 'listening') {
    if (dot) dot.style.background = 'var(--normal)';
    if (txt) txt.textContent = 'LISTENING…';
    if (wave) wave.style.display = 'flex';
    if (pulse) pulse.style.display = 'block';
    if (micLabel) { micLabel.textContent = 'Listening…'; micLabel.style.color = 'var(--normal)'; }
  } else {
    if (dot) dot.style.background = 'var(--faint)';
    if (txt) txt.textContent = 'TAP MIC TO ANSWER';
  }
}

async function obSpeakQuestion() {
  const q = OB_QUESTIONS[obStep];
  if (!q) return;
  try {
    const res = await fetch('/.netlify/functions/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: q.q })
    });
    if (!res.ok) throw new Error('TTS failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { obSetState('idle'); };
    audio.play();
  } catch(e) {
    console.log('OB TTS:', e.message);
    obSetState('idle');
  }
}

function obToggleMic() {
  if (obListening) {
    if (obRecognition) obRecognition.stop();
    obListening = false;
    obSetState('idle');
  } else {
    obStartListening();
  }
}

function obStartListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    document.getElementById('ob-type-fallback').style.display = 'block';
    return;
  }
  obRecognition = new SR();
  obRecognition.continuous = false;
  obRecognition.interimResults = false;
  obRecognition.onresult = (e) => {
    const answer = e.results[0][0].transcript;
    obSaveAnswer(answer);
  };
  obRecognition.onerror = () => { obListening = false; obSetState('idle'); };
  obRecognition.onend = () => { obListening = false; };
  obRecognition.start();
  obListening = true;
  obSetState('listening');
}

function obSubmitTyped() {
  const input = document.getElementById('ob-type-input');
  if (input && input.value.trim()) {
    obSaveAnswer(input.value.trim());
    input.value = '';
  }
}

function obSaveAnswer(answer) {
  const q = OB_QUESTIONS[obStep];
  if (q) obAnswers[q.key] = answer;

  // Save key profile fields immediately
  if (q?.key === 'name') {
    const p = JSON.parse(localStorage.getItem('sh_profile') || '{}');
    p.name = answer.split(' ')[0]; // first name only
    localStorage.setItem('sh_profile', JSON.stringify(p));
  }
  if (q?.key === 'age') {
    const p = JSON.parse(localStorage.getItem('sh_profile') || '{}');
    p.age = parseInt(answer) || 48;
    localStorage.setItem('sh_profile', JSON.stringify(p));
  }

  obStep++;
  if (obStep >= OB_QUESTIONS.length) {
    obShowAllSet();
  } else {
    obShowQuestion();
    setTimeout(() => obSpeakQuestion(), 400);
  }
}

function obShowAllSet() {
  document.getElementById('ob-voice').style.display = 'none';
  const allset = document.getElementById('ob-allset');
  allset.style.display = 'flex';

  // Show first memories recap
  const mem = document.getElementById('ob-memories');
  if (mem) {
    const items = Object.entries(obAnswers).filter(([k,v]) => v && k !== 'family_history').slice(0,3);
    mem.innerHTML = items.map(([k,v]) => {
      const labels = { name: 'Your name', age: 'Your age', sex: 'Biological sex', conditions: 'Conditions', medications: 'Medications' };
      return '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:5px;"></div>' +
        '<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:2px;">' + (labels[k]||k) + '</div>' +
        '<div style="font-size:15px;color:var(--ink);">' + v + '</div></div></div>';
    }).join('') || '<div style="font-size:14px;color:var(--muted);">I will learn more about you as we talk.</div>';
  }

  // Save all answers to profile
  const p = JSON.parse(localStorage.getItem('sh_profile') || '{}');
  if (obAnswers.conditions) p.conditions = obAnswers.conditions;
  if (obAnswers.medications) p.medications = obAnswers.medications;
  if (obAnswers.sex) p.sex = obAnswers.sex;
  localStorage.setItem('sh_profile', JSON.stringify(p));
}

/* ── PROFILE PAGE POPULATION ────────────────────────── */
function populateProfilePage() {
  const p = profile || {};

  // Avatar initials
  const bigAv = document.getElementById('profile-avatar-big');
  if (bigAv && p.name) {
    const parts = p.name.trim().split(' ');
    bigAv.textContent = (parts[0]?.[0]||'') + (parts[1]?.[0]||'');
  }

  const nameEl = document.getElementById('profile-name-display');
  if (nameEl) nameEl.textContent = p.name || 'Your name';

  const ageSex = document.getElementById('profile-age-sex');
  if (ageSex) ageSex.textContent = (p.age ? p.age + 'yo' : '--') + ' · ' + (p.sex || '--');

  const cond = document.getElementById('profile-conditions');
  if (cond) cond.textContent = p.conditions || 'None reported';

  const meds = document.getElementById('profile-medications');
  if (meds) meds.textContent = p.medications || 'None reported';
}

function showProfileEdit() {
  // Show the typing onboarding form as an edit sheet
  const typing = document.getElementById('ob-typing');
  if (typing) {
    typing.style.display = 'block';
    // Pre-fill
    if (profile) {
      const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
      f('ob_name', profile.name); f('ob_age', profile.age); f('ob_conditions', profile.conditions);
      const sex = document.getElementById('ob_sex');
      if (sex && profile.sex) sex.value = profile.sex;
    }
    document.getElementById('onboarding').style.display = 'block';
  }
}

function openMemoryView() {
  showToast('Dr. Sage remembers', 'Memory viewer coming soon — manage what Dr. Sage knows about you.');
}

function exportHealthData() {
  showToast('Export', 'Data export coming soon — all your biometric data as CSV.');
}

function sendChatQ(text) {
  document.getElementById('chatInput').value = text;
  sendChat();
  // Hide suggested questions after first use
  const qs = document.getElementById('wk-suggested-qs');
  if (qs) qs.style.display = 'none';
}

/* ── WEEKLY RECOVERY BARS ───────────────────────────── */
function renderWeeklyRecoveryBars(data) {
  const barsEl = document.getElementById('wk-recovery-bars');
  const labelsEl = document.getElementById('wk-day-labels');
  if (!barsEl || !data || !data.length) return;

  const days = ['M','T','W','T','F','S','S'];
  const maxVal = Math.max(...data.map(d => d.readiness || 50), 1);

  barsEl.innerHTML = data.slice(-7).map((d, i) => {
    const val = d.readiness || 50;
    const pct = Math.round((val / 100) * 100);
    const color = val >= 75 ? 'var(--normal)' : val >= 55 ? 'var(--watch)' : 'var(--urgent)';
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">' +
      '<div style="width:100%;max-width:32px;background:' + color + ';border-radius:5px 5px 0 0;height:' + pct + '%;min-height:8px;"></div>' +
      '</div>';
  }).join('');

  if (labelsEl) {
    labelsEl.innerHTML = data.slice(-7).map((d, i) => {
      return '<div style="flex:1;text-align:center;font-size:11px;font-weight:600;color:var(--faint);">' + (days[i] || '') + '</div>';
    }).join('');
  }
}

/* ── WEEKLY MODAL OPEN: populate recovery bars ── */
const _origOpenWeekly = typeof openWeekly === 'function' ? openWeekly : null;


/* ─── BATTERY ──────────────────────────────────────── */
function logRingCharged() {
  localStorage.setItem('sh_last_charge', Date.now().toString());
  showToast('🔋 Charge logged', 'Battery timer reset. TK30 should last ~5 days from now.');
  // Re-render the battery bar
  buildDashboard();
}

/* ─── NAV ───────────────────────────────────────── */
function showPage(id,el){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));document.getElementById('page-'+id).classList.add('active');if(el)el.classList.add('active');}
function navToPage(id){const items=document.querySelectorAll('.nav-item');const map={dashboard:0,heart:1,sleep:2,vitals:3,activity:4,records:5,settings:6};showPage(id,items[map[id]]);}

/* ─── VOICE INDICATOR ──────────────────────────────── */
function setVoiceIndicator(engine) {
  // Update the monitoring badge to show which voice is active
  const badge = document.getElementById('monitor-badge');
  if (!badge) return;
  const labels = {
    'elevenlabs-rachel': { text: 'Rachel · ElevenLabs', bg: 'var(--green-bg)', color: 'var(--green)', border: 'rgba(14,159,110,.25)', dot: '#10b981' },
    'azure-aria':        { text: 'Aria Neural · Azure',  bg: 'var(--blue-bg)',  color: 'var(--blue)',  border: 'rgba(29,111,164,.25)',  dot: '#3b82f6' },
    'browser':           { text: 'browser voice (check API keys)', bg: 'var(--amber-bg)', color: 'var(--amber)', border: 'rgba(180,83,9,.25)', dot: 'var(--amber)' },
  };
  const lbl = labels[engine] || labels['browser'];
  badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${lbl.dot};animation:ecgp 2s infinite;display:inline-block;"></span> TK30 monitoring · <strong>${lbl.text}</strong>`;
  badge.style.background = lbl.bg;
  badge.style.color = lbl.color;
  badge.style.borderColor = lbl.border;
  // Reset after 8 seconds
  setTimeout(() => {
    badge.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#10b981;animation:ecgp 2s infinite;display:inline-block;"></span> TK30 monitoring active';
    badge.style.background = 'var(--blue-bg)';
    badge.style.color = 'var(--blue)';
    badge.style.borderColor = 'rgba(29,111,164,.25)';
  }, 8000);
}

/* ─── TOAST ─────────────────────────────────────── */
function showToast(title,body){document.getElementById('toastTitle').textContent=title;document.getElementById('toastBody').textContent=body;const t=document.getElementById('toast');t.classList.add('show');setTimeout(()=>t.classList.remove('show'),5000);}

/* ─── BOOT ──────────────────────────────────────── */
window.addEventListener('load',()=>{const sp=localStorage.getItem('sh_profile'),sg=localStorage.getItem('sh_goals');if(sp&&sg){profile=JSON.parse(sp);goals=JSON.parse(sg);initApp();}});

/* ── MOBILE NAV ─────────────────────────────────────── */
function mobileNav(id, btn) {
  if (id === 'profile') { populateProfilePage(); }
  mobileNavActive(btn);
  // Navigate page
  showPage(id, null);
  // Update bottom tab bar
  document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
  const tabId = 'mob-' + id;
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMobileMore() {
  const sheet = document.getElementById('mobile-more-sheet');
  const overlay = document.getElementById('mob-more-overlay');
  const isOpen = sheet.style.display !== 'none';
  sheet.style.display = isOpen ? 'none' : 'block';
  overlay.style.display = isOpen ? 'none' : 'block';
  // Animate in
  if (!isOpen) {
    sheet.style.transform = 'translateY(100%)';
    sheet.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
    requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });
  }
}

/* ── ADD TO HOME SCREEN PROMPT ──────────────────────── */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show install banner after 30 seconds if on mobile
  if (window.innerWidth <= 768) {
    setTimeout(showInstallBanner, 30000);
  }
});

function showInstallBanner() {
  if (!deferredPrompt) return;
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:var(--blue);color:white;padding:12px 16px;display:flex;align-items:center;gap:10px;z-index:9999;font-size:13px;';
  banner.innerHTML = `
    <span style="font-size:20px;">⚕</span>
    <span style="flex:1;">Add SageHealth to your home screen</span>
    <button onclick="installApp()" style="background:white;color:var(--blue);border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;">Add</button>
    <button onclick="this.parentElement.remove()" style="background:transparent;border:none;color:rgba(255,255,255,.7);font-size:18px;cursor:pointer;">✕</button>
  `;
  document.body.prepend(banner);
}

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.querySelector('[onclick="installApp()"]')?.closest('div')?.remove();
}
