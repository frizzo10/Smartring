/* ─── STATE ─────────────────────────────────────── */
let profile={},goals={},data=[],consultHistory=[],chatMessages=[],voiceOn=false,wtVoiceOn=true,wtIdx=0,wtSteps=[],ecgAnimId=null;

/* ─── ONBOARDING ────────────────────────────────── */
let obStep=0;
function nextOb(n){
  document.getElementById('s'+obStep).classList.remove('on');
  obStep=n;
  document.getElementById('s'+n).classList.add('on');
  for(let i=0;i<=3;i++) document.getElementById('p'+i).classList.toggle('on',i<=n);
}
function finishOb(){
  profile={
    name:document.getElementById('ob_name').value||'Frank',
    age:parseInt(document.getElementById('ob_age').value)||48,
    weight:parseInt(document.getElementById('ob_weight').value)||185,
    height:parseFloat(document.getElementById('ob_height').value)||5.11,
    sex:document.getElementById('ob_sex').value||'Male',
    conditions:document.getElementById('ob_conditions').value||''
  };
  goals={
    steps:parseInt(document.getElementById('ob_steps').value)||8000,
    sleep:parseFloat(document.getElementById('ob_sleep').value)||7.5,
    apnea:parseInt(document.getElementById('ob_apnea').value)||2,
    spo2:parseInt(document.getElementById('ob_spo2').value)||92
  };
  localStorage.setItem('sh_profile',JSON.stringify(profile));
  localStorage.setItem('sh_goals',JSON.stringify(goals));
  initApp();
}

/* ─── DEMO DATA — all 7 TK30 sensors ───────────── */
function genData(){
  return Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i));
    const hrv=Math.round(48+Math.random()*30);
    const rhr=Math.round(56+Math.random()*14);
    const sleep=+(6.5+Math.random()*2).toFixed(1);
    const deep=+(sleep*(0.15+Math.random()*0.1)).toFixed(1);
    const rem=+(sleep*(0.18+Math.random()*0.1)).toFixed(1);
    const light=+(sleep-deep-rem-0.3).toFixed(1);
    const steps=Math.round(5000+Math.random()*7000);
    const spo2=+(96+Math.random()*3).toFixed(1);
    const apnea=Math.floor(Math.random()*3);
    const bpSys=Math.round(115+(rhr-60)*.6+(60-hrv)*.2);
    const bpDia=Math.round(75+(rhr-60)*.3);
    const temp=+(36.2+Math.random()*.8).toFixed(1);
    const tempBase=36.6;
    const tempDev=+(temp-tempBase).toFixed(1);
    const resp=+(13+(70-hrv)*.04).toFixed(1);
    const readiness=Math.min(100,Math.round((hrv/75*40)+((72-rhr)/16*30)+(deep/1.5*30)));
    const sleepScore=Math.min(100,Math.round((sleep/(goals.sleep||7.5)*40)+(deep/1.5*35)+(rem/1.8*25)));
    const calories=Math.round(steps*.04*(profile.weight||185)/100);
    const distance=+(steps*.00047).toFixed(1);
    return{date:d,hrv,rhr,sleep,deep,rem,light,steps,spo2,apnea,bpSys,bpDia,temp,tempDev,tempBase,resp,readiness,sleepScore,calories,distance};
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
function chipCss(s){
  return{
    great:{bg:'rgba(0,214,143,.1)',c:'var(--green)'},
    good:{bg:'rgba(0,184,217,.1)',c:'var(--cyan)'},
    watch:{bg:'rgba(245,158,11,.1)',c:'var(--amber)'},
    alert:{bg:'rgba(240,82,82,.1)',c:'var(--red)'}
  }[s];
}

/* ─── INTERPRETATIONS ───────────────────────────── */
function iRHR(v){
  if(v<60) return`Resting heart rate of ${v} BPM is in the athletic range. Your heart pumps more blood per beat and doesn't have to work as hard — less wear, more reserve. A direct result of cardiovascular conditioning.`;
  if(v<70) return`Resting heart rate of ${v} BPM is in the healthy range. A lower number means a more efficient heart. At 60–70, your cardiovascular system is working well.`;
  if(v<80) return`Resting heart rate of ${v} BPM is mildly elevated. Common causes: dehydration, caffeine, stress, or reduced sleep quality. Your heart is working harder than it needs to at rest.`;
  return`Resting heart rate of ${v} BPM is elevated. Consistently above 80 means sustained cardiovascular load even at rest. Monitor for a week; if it stays elevated, mention it to your doctor.`;
}
function iHRV(v,age){
  const exp=Math.round(65-age*.5);
  if(v>=exp+10) return`HRV of ${v}ms is well above average for age ${age}. High variation between beats means your nervous system is responsive and adaptable — your body's internal stress meter reads low stress today.`;
  if(v>=exp-5) return`HRV of ${v}ms is within normal range for your age. Your autonomic nervous system is balanced. Think of HRV as a stress meter — yours is reading stable today.`;
  if(v>=exp-15) return`HRV of ${v}ms is slightly below the expected range for age ${age}. This can mean accumulated fatigue, poor sleep, or early illness. It's a warning signal before you consciously feel it.`;
  return`HRV of ${v}ms is significantly below the age-adjusted norm. Your nervous system is under meaningful load. Prioritize rest — this is your body telling you something before symptoms arrive.`;
}
function iSpO2(v){
  if(v>=97) return`SpO₂ of ${v}% is optimal. Your red blood cells are fully loaded with oxygen — every organ and muscle is getting what it needs. Think of it like counting full trucks vs empty ones. Yours are full.`;
  if(v>=95) return`SpO₂ of ${v}% is normal. Healthy adults range 95–100%. Your lungs are moving air efficiently and your blood is carrying it well.`;
  if(v>=92) return`SpO₂ of ${v}% is mildly below normal. Repeated readings below 95% during sleep can indicate breathing disruptions — possibly sleep apnea. Worth monitoring over the next week.`;
  return`SpO₂ of ${v}% is below the safe threshold. Values under 92% mean your blood isn't carrying enough oxygen. This requires medical attention.`;
}
function iBP(s,d){
  if(s<120) return`Blood pressure of ${s}/${d} mmHg is optimal. Your heart is exerting pressure on your arteries in the best-case range. This is where cardiovascular disease risk is lowest.`;
  if(s<130) return`Blood pressure of ${s}/${d} mmHg is in the normal range. Your heart is pumping at a healthy pressure — no concern at this level.`;
  if(s<140) return`Blood pressure of ${s}/${d} is elevated (Stage 1 range). Over time, elevated BP silently damages artery walls. Hydration, salt reduction, and daily movement are your primary levers.`;
  return`Blood pressure of ${s}/${d} mmHg is in the high range. Consistent readings above 140 should be discussed with your doctor.`;
}
function iTemp(t,dev,base){
  if(Math.abs(dev)<=0.3) return`Body temperature of ${t}°C is within your personal baseline (${base}°C). Thermoregulation is normal — no inflammatory signals detected overnight.`;
  if(dev>0.3&&dev<=0.5) return`Temperature of ${t}°C is slightly above your ${base}°C baseline (+${dev}°C). This is the watch zone — could be nothing, or early immune activation. Track over the next 24–48 hours.`;
  if(dev>0.5) return`Temperature of ${t}°C is ${dev}°C above baseline. This is your TK30's illness early warning. Your immune system may be responding — expect symptoms in 12–48 hours if this continues.`;
  return`Temperature of ${t}°C is slightly below baseline. This can happen during high-quality deep sleep or good cardiovascular recovery.`;
}
function iSleep(score,h,deep,rem){
  if(score>=85) return`${h}h sleep with ${deep}h deep and ${rem}h REM. Excellent architecture. Deep sleep is when your body physically repairs itself. REM is when your brain consolidates memory and processes emotion. You hit both targets.`;
  if(score>=70) return`${h}h with ${deep}h deep sleep. Good overall but deep sleep was below the 1.5h target. Deep sleep is your body's maintenance window — partial night means partial recovery.`;
  return`${h}h with ${deep}h deep sleep — below target. Sleep debt is cumulative. Each night below optimal builds a deficit that affects mood, immune function, and metabolism.`;
}
function iSteps(v,goal){
  const p=Math.round(v/goal*100);
  if(p>=100) return`Goal achieved: ${v.toLocaleString()} steps. Research consistently links 8,000+ daily steps to significantly lower all-cause mortality. Accumulated steps count the same as a single workout.`;
  if(p>=75) return`${v.toLocaleString()} steps — ${p}% of goal. A 15-minute walk closes the gap. Each 1,000 steps above 4,000 reduces cardiovascular risk by another 6%.`;
  return`${v.toLocaleString()} steps — below target. Prolonged sitting independently raises blood sugar, stiffens arteries, and compresses spinal discs regardless of other exercise.`;
}

/* ─── CHART CONFIG ──────────────────────────────── */
const chartOpts=(min,max)=>({
  responsive:true,maintainAspectRatio:false,
  plugins:{legend:{display:false}},
  scales:{
    x:{ticks:{color:'#5a6a85',font:{size:10}},grid:{display:false}},
    y:{ticks:{color:'#5a6a85',font:{size:10}},grid:{color:'rgba(255,255,255,.04)'},min,max}
  }
});

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
  const today=new Date(),isMon=today.getDay()===1;
  const lw=localStorage.getItem('sh_nl'),tw=today.toISOString().slice(0,10);
  if(isMon&&lw!==tw){localStorage.setItem('sh_nl',tw);setTimeout(()=>openWeekly(),1400);}
}

function setGreeting(){
  const h=new Date().getHours(),n=profile.name||'Frank';
  const g=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  document.getElementById('dashGreet').textContent=g+', '+n;
  document.getElementById('dashDate').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('sav').textContent=n[0].toUpperCase();
  document.getElementById('sname').textContent=n;
}

/* ─── DASHBOARD ─────────────────────────────────── */
function buildDashboard(){
  const t=data[data.length-1],age=profile.age||48;
  const stepsGoal=goals.steps||8000;

  // Briefing
  const ca=Math.max(25,age+(t.rhr<60?-3:t.rhr>72?3:0)+(t.hrv>60?-2:t.hrv<40?2:0)+(t.spo2<95?2:0));
  let br=`Readiness <strong>${t.readiness}/100</strong>. Sleep ${t.sleep}h with <strong>${t.deep}h deep</strong>. HRV <strong>${t.hrv}ms</strong>. HR <strong>${t.rhr} BPM</strong>. BP <strong>${t.bpSys}/${t.bpDia}</strong> mmHg. `;
  br+=`Temp <strong>${t.temp}°C</strong>${t.tempDev>0.4?` <span class="warn">(+${t.tempDev}°C above baseline — monitor)</span>`:' (baseline normal)'}. SpO₂ <strong>${t.spo2}%</strong>. `;
  if(t.apnea>2) br+=`<span class="warn">⚠ ${t.apnea} airway events overnight.</span> `;
  const sl=Math.max(0,stepsGoal-t.steps);
  br+=sl>0?`<span class="warn">${sl.toLocaleString()} steps to goal.</span>`:`Step goal achieved. `;
  if(ca<age) br+=`CV age estimate <strong>${ca}</strong> — ${age-ca} yrs younger than actual.`;
  document.getElementById('dailySummary').innerHTML=br;

  // Top 6 stat cards
  const pages=['activity','heart','heart','vitals','vitals','sleep'];
  const cards=[
    {label:'Steps',val:t.steps.toLocaleString(),sub:Math.min(100,Math.round(t.steps/stepsGoal*100))+'% of goal',st:t.steps>=stepsGoal?'great':t.steps>=stepsGoal*.75?'good':'watch',c:'var(--green)',pi:0},
    {label:'Heart rate',val:t.rhr+' BPM',sub:'Resting',st:rhrSt(t.rhr),c:'var(--red)',pi:1},
    {label:'HRV',val:t.hrv+' ms',sub:'RMSSD overnight',st:hrvSt(t.hrv),c:'var(--green)',pi:2},
    {label:'Blood pressure',val:t.bpSys+'/'+t.bpDia,sub:'mmHg · TK30',st:bpSt(t.bpSys),c:'var(--pink)',pi:3},
    {label:'Body temp',val:t.temp+'°C',sub:(t.tempDev>=0?'+':'')+t.tempDev+'°C from baseline',st:tempSt(t.tempDev),c:'var(--amber)',pi:4},
    {label:'SpO₂',val:t.spo2+'%',sub:'Overnight avg',st:spo2St(t.spo2),c:'var(--cyan)',pi:5},
  ];
  document.getElementById('top-stats').innerHTML=cards.map((s,i)=>{
    const css=chipCss(s.st);
    return`<div class="sc" onclick="navToPage('${pages[i]}')">
      <div class="sc-label">${s.label}</div>
      <div class="sc-val" style="color:${s.c}">${s.val}</div>
      <div class="sc-sub">${s.sub}</div>
      <div class="sc-status" style="color:${css.c}">${slLabel(s.st)}</div>
    </div>`;
  }).join('');

  // Deep-dive cards — 3 rows of 2
  const el=document.getElementById('dash-metrics');
  el.innerHTML=`<div class="two-col" id="dd-r1"></div><div class="two-col" id="dd-r2"></div><div class="two-col" id="dd-r3"></div>`;
  const labels=data.map(d=>d.date.toLocaleDateString('en-US',{weekday:'short'}));

  function scale(val,min,max,zones){
    const pct=Math.max(0,Math.min(100,(val-min)/(max-min)*100));
    const segs=zones.map(z=>`<div style="flex:${z.to-z.from};background:${z.c};opacity:.65;"></div>`).join('');
    return`<div class="dd-scale"><div class="dd-scale-track">${segs}</div><div style="position:relative;height:12px;"><div class="dd-scale-marker" style="left:${pct}%;"></div></div><div class="dd-scale-labels"><span>${min}</span><span>${max}</span></div></div>`;
  }
  function stat3(a,b,c){
    return [a,b,c].map(s=>`<div class="dd-stat"><div class="dd-stat-val" style="color:${s[2]||'var(--text)'}">${s[0]}</div><div class="dd-stat-label">${s[1]}</div></div>`).join('');
  }
  function ddCard(opts){
    const css=chipCss(opts.status);
    return`<div class="dd">
      <div class="dd-head">
        <div class="dd-left">
          <div class="dd-name">${opts.name}</div>
          <div class="dd-val-row">
            <span class="dd-val" style="color:${css.c}">${opts.value}</span>
            <span class="dd-unit">${opts.unit}</span>
            <span class="dd-chip" style="background:${css.bg};color:${css.c}">${slLabel(opts.status)}</span>
          </div>
          <div class="dd-what">${opts.what}</div>
          <div class="dd-why">${opts.why}</div>
          ${opts.extra||''}
        </div>
        <div class="dd-chart">
          <div class="dd-chart-label">7-day trend</div>
          <div style="position:relative;height:110px;"><canvas id="${opts.cid}"></canvas></div>
        </div>
      </div>
      ${opts.bottom?`<div class="dd-bottom">${opts.bottom}</div>`:''}
    </div>`;
  }

  setTimeout(()=>{
    document.getElementById('dd-r1').innerHTML=
      ddCard({name:'Resting heart rate',value:t.rhr,unit:'BPM',status:rhrSt(t.rhr),what:'How fast your heart beats completely at rest.',why:iRHR(t.rhr),extra:scale(t.rhr,40,110,[{from:0,to:20,c:'#9b72f5'},{from:20,to:30,c:'#00d68f'},{from:30,to:50,c:'#f59e0b'},{from:50,to:70,c:'#f05252'}]),cid:'dd-rhr',bottom:stat3([avg(data,'rhr')+' BPM','7-day avg','var(--cyan)'],[Math.min(...data.map(d=>d.rhr))+' BPM','Lowest','var(--green)'],['60–70 BPM','Reference','var(--muted)'])})+
      ddCard({name:'Heart rate variability (HRV)',value:t.hrv,unit:'ms',status:hrvSt(t.hrv),what:'Tiny gaps between heartbeats. More variation = healthier nervous system.',why:iHRV(t.hrv,age),extra:scale(t.hrv,10,100,[{from:0,to:30,c:'#f05252'},{from:30,to:50,c:'#f59e0b'},{from:50,to:60,c:'#00b8d9'},{from:60,to:40,c:'#00d68f'}]),cid:'dd-hrv',bottom:stat3([avg(data,'hrv')+' ms','7-day avg','var(--green)'],[Math.max(...data.map(d=>d.hrv))+' ms','Best','var(--green)'],[Math.round(65-age*.5)+' ms','Age norm','var(--muted)'])});

    document.getElementById('dd-r2').innerHTML=
      ddCard({name:'Blood pressure (TK30)',value:t.bpSys+'/'+t.bpDia,unit:'mmHg',status:bpSt(t.bpSys),what:'Pressure your heart exerts on your artery walls with each beat.',why:iBP(t.bpSys,t.bpDia),extra:scale(t.bpSys,80,160,[{from:0,to:25,c:'#9b72f5'},{from:25,to:31,c:'#00d68f'},{from:31,to:44,c:'#f59e0b'},{from:44,to:56,c:'#f05252'}]),cid:'dd-bp',bottom:stat3([avg(data,'bpSys')+' mmHg','7-day sys avg','var(--pink)'],[avg(data,'bpDia')+' mmHg','7-day dia avg','var(--purple)'],['<120/80','Optimal','var(--muted)'])})+
      ddCard({name:'Body temperature (TK30)',value:t.temp+'°C',unit:'',status:tempSt(t.tempDev),what:'Overnight skin temperature — the earliest illness warning available.',why:iTemp(t.temp,t.tempDev,t.tempBase),extra:`<div style="font-size:12px;color:var(--muted);margin-top:8px;">Baseline: ${t.tempBase}°C · Deviation: <strong style="color:${t.tempDev>0.4?'var(--amber)':'var(--green)'}">${t.tempDev>=0?'+':''}${t.tempDev}°C</strong></div>`,cid:'dd-temp',bottom:stat3([avgF(data,'temp')+'°C','7-day avg','var(--amber)'],[t.tempBase+'°C','Baseline','var(--muted)'],[(t.tempDev>=0?'+':'')+t.tempDev+'°C','Today\'s dev',t.tempDev>0.4?'var(--amber)':'var(--green)'])});

    document.getElementById('dd-r3').innerHTML=
      ddCard({name:'Blood oxygen SpO₂',value:t.spo2+'%',unit:'',status:spo2St(t.spo2),what:'Percentage of red blood cells carrying oxygen to organs and muscles.',why:iSpO2(t.spo2),extra:scale(t.spo2,85,100,[{from:0,to:7,c:'#f05252'},{from:7,to:10,c:'#f59e0b'},{from:10,to:15,c:'#00d68f'}]),cid:'dd-spo2',bottom:stat3([avgF(data,'spo2')+'%','7-day avg','var(--cyan)'],[t.apnea,'Apnea events',t.apnea>2?'var(--amber)':'var(--green)'],['95–100%','Normal','var(--muted)'])})+
      ddCard({name:'Sleep last night',value:t.sleep+'h',unit:'',status:ssSt(t.sleepScore),what:'Total sleep and the quality of your sleep stages.',why:iSleep(t.sleepScore,t.sleep,t.deep,t.rem),extra:`<div class="sleep-bar">${[{c:'#4c35a8',f:t.deep*.5},{c:'#6b52c4',f:t.light*.4},{c:'#4c35a8',f:t.deep*.5},{c:'#00b8d9',f:t.rem*.6},{c:'#1a2535',f:.25},{c:'#00b8d9',f:t.rem*.4},{c:'#6b52c4',f:t.light*.6}].map(s=>`<div style="flex:${s.f};background:${s.c};border-radius:3px;"></div>`).join('')}</div><div class="sleep-leg">${[['#4c35a8','Deep'],['#6b52c4','Light'],['#00b8d9','REM'],['#1a2535','Awake']].map(([c,l])=>`<div class="sl-i"><div class="sl-d" style="background:${c};"></div>${l}</div>`).join('')}</div>`,cid:'dd-sleep',bottom:stat3([t.deep+'h','Deep','#7c5ddb'],[t.rem+'h','REM','var(--cyan)'],[avgF(data,'sleep')+'h','7-day avg','var(--muted)'])});

    const mk=(id,vals,color,type,min,max)=>{
      const el=document.getElementById(id); if(!el) return;
      new Chart(el,{type:type||'line',data:{labels,datasets:[{data:vals,borderColor:color,backgroundColor:color.replace('#','rgba(').replace(/$/,', .07)').replace('rgba(','rgba(').replace(/rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i,(_,r,g,b)=>`rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`),tension:.4,pointBackgroundColor:color,pointRadius:3,fill:true,borderRadius:type==='bar'?4:0}]},options:chartOpts(min,max)});
    };
    mk('dd-rhr',data.map(d=>d.rhr),'#f05252','line',45,95);
    mk('dd-hrv',data.map(d=>d.hrv),'#00d68f','line',20,100);
    mk('dd-bp',data.map(d=>d.bpSys),'#ec4899','line',90,160);
    mk('dd-temp',data.map(d=>d.temp),'#f59e0b','line',35.5,37.5);
    mk('dd-spo2',data.map(d=>d.spo2),'#00b8d9','line',90,100);
    mk('dd-sleep',data.map(d=>d.sleep),'#9b72f5','bar',0,10);
  },50);
}

/* ─── SUBPAGES ──────────────────────────────────── */
function buildSubpages(){
  const labels=data.map(d=>d.date.toLocaleDateString('en-US',{weekday:'short'}));
  const t=data[data.length-1],age=profile.age||48;

  function vc(label,val,unit,st,why,ref){
    const css=chipCss(st);
    return`<div style="background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;">${label}</div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:${css.bg};color:${css.c}">${slLabel(st)}</span>
      </div>
      <div style="font-size:25px;font-weight:700;font-family:var(--mono);color:${css.c};line-height:1;margin-bottom:3px;">${val}<span style="font-size:12px;color:var(--muted);font-weight:400;font-family:var(--font);margin-left:4px;">${unit}</span></div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:7px;">${ref}</div>
      <div style="font-size:12px;color:#7a92b5;line-height:1.6;padding-top:7px;border-top:1px solid var(--border);">${why}</div>
    </div>`;
  }

  // Heart page
  document.getElementById('heart-vitals').innerHTML=
    vc('Resting HR',t.rhr,'BPM',rhrSt(t.rhr),iRHR(t.rhr),'Ref: 60–70 BPM')+
    vc('HRV (RMSSD)',t.hrv,'ms',hrvSt(t.hrv),iHRV(t.hrv,age),'Higher = better recovery')+
    vc('Blood pressure',t.bpSys+'/'+t.bpDia,'mmHg',bpSt(t.bpSys),iBP(t.bpSys,t.bpDia),'Optimal: <120/80')+
    vc('Resp. rate',t.resp,'/min',t.resp<18?'good':'watch',`${t.resp} breaths/min — ${t.resp<18?'within normal resting range (12–20)':'slightly elevated'}.`,'Normal: 12–20');
  document.getElementById('hrv7-sub').textContent=`7-day avg ${avg(data,'hrv')}ms. ${avg(data,'hrv')>=55?'Nervous system recovering well.':'Below optimal — consistent sleep helps most.'}`;
  document.getElementById('rhr7-sub').textContent=`7-day avg ${avg(data,'rhr')} BPM. ${avg(data,'rhr')<65?'Excellent cardiovascular conditioning.':'Within normal range.'}`;
  document.getElementById('bp7-sub').textContent=`Systolic avg ${avg(data,'bpSys')} mmHg. ${avg(data,'bpSys')<130?'Healthy range this week.':'Elevated trend — hydration, salt, and movement are your primary levers.'}`;

  const mkLine=(id,vals,color,min,max)=>new Chart(document.getElementById(id),{type:'line',data:{labels,datasets:[{data:vals,borderColor:color,backgroundColor:color+'18',tension:.4,pointBackgroundColor:color,pointRadius:3,fill:true}]},options:chartOpts(min,max)});
  const mkBar=(id,vals,colors,min,max)=>new Chart(document.getElementById(id),{type:'bar',data:{labels,datasets:[{data:vals,backgroundColor:colors,borderRadius:5}]},options:chartOpts(min,max)});

  mkLine('hrv7Chart',data.map(d=>d.hrv),'#00d68f',20,100);
  mkLine('rhr7Chart',data.map(d=>d.rhr),'#f05252',45,90);
  new Chart(document.getElementById('bp7Chart'),{type:'line',data:{labels,datasets:[{data:data.map(d=>d.bpSys),label:'Systolic',borderColor:'#ec4899',backgroundColor:'#ec489912',tension:.4,pointRadius:3,fill:true},{data:data.map(d=>d.bpDia),label:'Diastolic',borderColor:'#9b72f5',backgroundColor:'#9b72f508',tension:.4,pointRadius:3,fill:true}]},options:{...chartOpts(60,160),plugins:{legend:{display:true,labels:{color:'#5a6a85',font:{size:10}}}}}});

  // Sleep page
  document.getElementById('sleep-vitals').innerHTML=
    vc('Avg sleep (7d)',avgF(data,'sleep'),'hrs',avgF(data,'sleep')>=7?'great':'watch',`7-day average of ${avgF(data,'sleep')}h. ${avgF(data,'sleep')>=7?'Within the recommended 7–9h adult range.':'Below the 7h minimum — cumulative debt builds.'}`,'Target: 7–9h')+
    vc('Deep sleep',t.deep,'hrs',t.deep>=1.5?'great':t.deep>=1?'good':'watch',`${t.deep}h deep sleep. ${t.deep>=1.5?'Optimal — physical repair, immune function, growth hormone.':'Below 1.5h target. Alcohol and irregular bedtimes reduce deep sleep most.'}`,'Target: 1.5–2h')+
    vc('REM sleep',t.rem,'hrs',t.rem>=1.5?'great':t.rem>=1?'good':'watch',`${t.rem}h REM. ${t.rem>=1.5?'Strong — emotion processing and memory consolidation are well supported.':'Below optimal. Stress is the primary suppressor.'}`,'Target: 1.5–2h')+
    vc('Apnea events',t.apnea,'events',t.apnea<=(goals.apnea||2)?'great':t.apnea<=4?'watch':'alert',`${t.apnea} events detected overnight. ${t.apnea<=(goals.apnea||2)?'Within acceptable range.':'Side-sleeping and avoiding alcohol before bed reduce events significantly.'}`,'Target: ≤'+(goals.apnea||2));
  document.getElementById('sleep7-sub').textContent=`7-day average ${avgF(data,'sleep')}h. ${avgF(data,'sleep')>=7?'Consistently within recommended range.':'Aim to move bedtime 20 minutes earlier this week.'}`;
  document.getElementById('spo2-7-sub').textContent=`Average SpO₂ ${avgF(data,'spo2')}%. Monitor nights below 92% — may indicate sleep-disordered breathing.`;
  document.getElementById('temp7-sub').textContent=`Average ${avgF(data,'temp')}°C. Deviations above +0.5°C from your baseline are the earliest illness indicator — 12–48h before symptoms.`;
  mkBar('sleep7Chart',data.map(d=>d.sleep),data.map(d=>d.sleep>=(goals.sleep||7.5)?'rgba(155,114,245,.6)':'rgba(155,114,245,.25)'),0,10);
  mkLine('spo27Chart',data.map(d=>d.spo2),'#00b8d9',90,100);
  mkLine('temp7Chart',data.map(d=>d.temp),'#f59e0b',35.5,37.5);

  // Vitals page
  document.getElementById('vitals-row').innerHTML=
    vc('Blood pressure',t.bpSys+'/'+t.bpDia,'mmHg',bpSt(t.bpSys),iBP(t.bpSys,t.bpDia),'TK30 cuffless estimate')+
    vc('Body temperature',t.temp,'°C',tempSt(t.tempDev),iTemp(t.temp,t.tempDev,t.tempBase),'Baseline: '+t.tempBase+'°C')+
    vc('SpO₂',t.spo2,'%',spo2St(t.spo2),iSpO2(t.spo2),'Normal: 95–100%')+
    vc('Resp. rate',t.resp,'/min',t.resp<18?'good':'watch',`${t.resp} breaths/min overnight.`,'Normal: 12–20');
  document.getElementById('bpsys-sub').textContent=`Systolic 7-day avg: ${avg(data,'bpSys')} mmHg. ${avg(data,'bpSys')<130?'Healthy range.':'Elevated trend. Reduce sodium, increase water, add daily walking.'}`;
  document.getElementById('tempv-sub').textContent=`7-day avg: ${avgF(data,'temp')}°C. Your ring logs overnight — deviations from personal baseline are the most clinically valuable signal.`;
  mkLine('bpSysChart',data.map(d=>d.bpSys),'#ec4899',90,160);
  mkLine('tempVChart',data.map(d=>d.temp),'#f59e0b',35.5,37.5);

  // Activity page
  document.getElementById('act-vitals').innerHTML=
    vc('Steps today',t.steps.toLocaleString(),'',t.steps>=(goals.steps||8000)?'great':t.steps>=(goals.steps||8000)*.75?'good':'watch',iSteps(t.steps,goals.steps||8000),'Goal: '+(goals.steps||8000).toLocaleString())+
    vc('Calories',t.calories,'kcal','good','Active calories above basal metabolic rate — energy expended through movement today.','Movement only')+
    vc('Distance',t.distance,'miles','good',`${t.distance} miles — approx ${Math.round(t.distance*20)} minutes of walking equivalent.`,'Step + stride estimate')+
    vc('Active hours',Math.round(t.steps/1200),'hrs',Math.round(t.steps/1200)>=6?'great':'good','Hours with meaningful movement. Breaking up sedentary time reduces cardiovascular risk independently.','Hours >250 steps');
  document.getElementById('steps7-sub').textContent=`7-day avg ${avg(data,'steps').toLocaleString()} steps. ${avg(data,'steps')>=(goals.steps||8000)?'Consistently meeting your target.':'One extra 10-minute walk per day adds ~1,000 steps.'}`;
  mkBar('steps7Chart',data.map(d=>d.steps),data.map(d=>d.steps>=(goals.steps||8000)?'rgba(0,214,143,.6)':'rgba(59,130,246,.4)'),0,Math.max(...data.map(d=>d.steps))*1.2);
}

/* ─── ECG ───────────────────────────────────────── */
function openECG(){
  document.getElementById('ecgModal').style.display='flex';
  document.getElementById('ecgReading').textContent='';
  const t=data[data.length-1];
  document.getElementById('ecg-hr').textContent=t.rhr;
  document.getElementById('ecg-hrv').textContent=t.hrv;
  document.getElementById('ecg-status').textContent=t.rhr<60?'Sinus bradycardia · Rate below 60 BPM':t.rhr>100?'Elevated rate · Monitor trend':'Normal sinus rhythm · Regular rate and rhythm';
  setTimeout(()=>startECG(),60);
}
function closeECG(){
  document.getElementById('ecgModal').style.display='none';
  if(ecgAnimId){cancelAnimationFrame(ecgAnimId);ecgAnimId=null;}
  stopSpeech();
}
function sageReadsECG(){
  const t=data[data.length-1],name=profile.name||'Frank';
  const btn=document.getElementById('ecgReadBtn');
  btn.disabled=true; btn.textContent='Reading...';
  const rhythm=t.rhr<60?'sinus bradycardia — your rate is below 60, common in conditioned individuals':t.rhr>100?'elevated rate — above 100 at rest warrants monitoring':'normal sinus rhythm — regular rate, regular spacing between beats';
  const hrvNote=t.hrv>=60?`Your HRV of ${t.hrv} milliseconds is above average — excellent autonomic recovery.`:t.hrv>=45?`Your HRV of ${t.hrv} milliseconds is within normal range.`:`Your HRV of ${t.hrv} milliseconds is below optimal — your nervous system is under load.`;
  const reading=`Good ${new Date().getHours()<12?'morning':'afternoon'}, ${name}. Looking at your TK30 cardiac data. I'm seeing ${rhythm}. Heart rate at ${t.rhr} beats per minute. ${hrvNote} The QRS complex is clean and regular. T wave recovery looks normal. ${t.rhr<70?'Overall your cardiac profile is reassuring today.':'Stay hydrated and monitor tomorrow.'} This is generated from your ring's ECG sensor — for a clinical ECG you'd want a KardiaMobile or a physician visit.`;
  document.getElementById('ecgReading').textContent=reading;
  speak(reading,()=>{btn.disabled=false;btn.textContent='▶ Read aloud';});
}
function ecgY(p){
  p=p%1;
  if(p<.04) return 5*Math.sin(p/.04*Math.PI);
  if(p<.12) return 0;
  if(p<.13) return -8*(p-.12)/.01;
  if(p<.15) return -8+50*(p-.13)/.02;
  if(p<.17) return 42-45*(p-.15)/.02;
  if(p<.19) return -3+3*(p-.17)/.02;
  if(p<.32) return 0;
  if(p<.5) return 10*Math.sin((p-.32)/.18*Math.PI);
  return 0;
}
function startECG(){
  const canvas=document.getElementById('ecgCanvas'); if(!canvas) return;
  const parent=canvas.parentElement, w=parent.clientWidth||700;
  canvas.width=w; canvas.height=100;
  canvas.style.width=w+'px'; canvas.style.height='100px';
  const ctx=canvas.getContext('2d');
  const t=data[data.length-1], period=60000/t.rhr;
  let phase=0, lastTime=null;
  function draw(ts){
    if(!lastTime) lastTime=ts;
    const dt=Math.min(ts-lastTime,50); lastTime=ts;
    const w=canvas.width, h=canvas.height, mid=h/2;
    if(!w||!h){ecgAnimId=requestAnimationFrame(draw);return;}
    const speed=w/3, dx=speed*dt/1000;
    if(dx>=1){
      const img=ctx.getImageData(Math.ceil(dx),0,w-Math.ceil(dx),h);
      ctx.clearRect(0,0,w,h);
      ctx.putImageData(img,0,0);
    }
    ctx.clearRect(w-Math.ceil(dx)-1,0,Math.ceil(dx)+3,h);
    ctx.strokeStyle='rgba(0,214,143,.06)'; ctx.lineWidth=.5;
    for(let gx=w%20;gx<w;gx+=20){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,h);ctx.stroke();}
    for(let gy=0;gy<h;gy+=18){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(w,gy);ctx.stroke();}
    ctx.strokeStyle='#00d68f'; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath();
    const steps=Math.ceil(dx)+2;
    for(let i=0;i<=steps;i++){
      const px=w-steps+i;
      const ph=(phase+i/speed/(period/1000))%1;
      const y=mid-ecgY(ph)*(mid*.8/25);
      if(i===0) ctx.moveTo(px,y); else ctx.lineTo(px,y);
    }
    ctx.stroke();
    phase+=dt/1000/(period/1000);
    ecgAnimId=requestAnimationFrame(draw);
  }
  if(ecgAnimId) cancelAnimationFrame(ecgAnimId);
  ecgAnimId=requestAnimationFrame(draw);
}

/* ─── VOICE ─────────────────────────────────────── */
function speak(text,onEnd){
  if(!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text.replace(/<[^>]*>/g,'').trim());
  u.rate=.92; u.pitch=1;
  const voices=window.speechSynthesis.getVoices();
  const pref=voices.find(v=>/samantha|karen|daniel|alex/i.test(v.name))||voices.find(v=>v.lang==='en-US')||voices[0];
  if(pref) u.voice=pref;
  if(onEnd) u.onend=onEnd;
  window.speechSynthesis.speak(u);
}
function stopSpeech(){if(window.speechSynthesis) window.speechSynthesis.cancel();}
function toggleVoice(){
  voiceOn=!voiceOn;
  const b=document.getElementById('chatVoiceBtn');
  b.textContent=voiceOn?'🔊':'🔇';
  b.classList.toggle('on',voiceOn);
}

/* ─── WALKTHROUGH ───────────────────────────────── */
function buildWtSteps(){
  const t=data[data.length-1],age=profile.age||48,name=profile.name||'Frank';
  const ca=Math.max(25,age+(t.rhr<60?-3:t.rhr>72?3:0)+(t.hrv>60?-2:t.hrv<40?2:0)+(t.spo2<95?2:0));
  return[
    {title:'Overview',text:`Good ${new Date().getHours()<12?'morning':'afternoon'}, ${name}. Your Wosheng TK30 ring collected data from 7 sensors last night. Readiness today is ${t.readiness} out of 100 — ${t.readiness>=85?'excellent, fully recovered':t.readiness>=70?'good, normal activity is appropriate':'moderate, lighter activity is advisable'}. Let's go through what each sensor found.`},
    {title:'Heart rate & HRV',text:`Resting heart rate was ${t.rhr} beats per minute — ${t.rhr<60?'excellent, in the athletic range. Your heart pumps more blood per beat and works less hard at rest':t.rhr<70?'healthy. Your heart is pumping efficiently':'mildly elevated. Common causes are dehydration, stress, or poor sleep'}. HRV was ${t.hrv} milliseconds — your body's internal stress meter. At ${t.hrv}ms, you're ${t.hrv>=60?'above average, excellent recovery':t.hrv>=45?'within normal range':'slightly below optimal'}.`},
    {title:'Blood pressure',text:`Your TK30 measured blood pressure at ${t.bpSys} over ${t.bpDia} millimeters of mercury. ${iBP(t.bpSys,t.bpDia)} This is a cuffless pulse wave estimate — meaningful for trend tracking but not a replacement for a proper arm cuff if readings are consistently elevated.`},
    {title:'Body temperature',text:`Overnight body temperature was ${t.temp} degrees Celsius. Your personal baseline is ${t.tempBase}°C, so today's deviation is ${t.tempDev>=0?'+':''}${t.tempDev}°C. ${iTemp(t.temp,t.tempDev,t.tempBase)} Temperature spikes 12 to 48 hours before you feel sick — this is the earliest warning system available.`},
    {title:'Blood oxygen',text:`Overnight blood oxygen was ${t.spo2} percent. ${iSpO2(t.spo2)} You had ${t.apnea} airway events detected. ${t.apnea===0?'Clean night.':t.apnea<=2?'Within acceptable range.':'Above the two-event target. Side-sleeping and avoiding alcohol before bed are the most effective interventions.'}`},
    {title:'Sleep architecture',text:`You slept ${t.sleep} hours with ${t.deep} hours of deep sleep and ${t.rem} hours of REM. ${iSleep(t.sleepScore,t.sleep,t.deep,t.rem)} The stage chart on your Sleep page shows how you cycled through each phase.`},
    {title:'Activity & CV age',text:`${t.steps.toLocaleString()} steps today — ${Math.round(t.steps/(goals.steps||8000)*100)}% of your ${(goals.steps||8000).toLocaleString()} goal. ${iSteps(t.steps,goals.steps||8000)} Based on your HRV, resting HR, and SpO₂, your cardiovascular system is performing like a ${ca} year old. ${ca<age?`That's ${age-ca} years younger than your actual age.`:'Matching your actual age — a solid baseline.'}`},
  ];
}
function startWt(){
  wtSteps=buildWtSteps(); wtIdx=0;
  document.getElementById('wtOverlay').classList.add('open');
  const pips=document.getElementById('wtPips');
  pips.innerHTML=wtSteps.map((_,i)=>`<div class="wt-pip" id="wp${i}"></div>`).join('');
  renderWt();
}
function renderWt(){
  const s=wtSteps[wtIdx];
  document.getElementById('wtBody').textContent=s.text;
  document.getElementById('wtStep').textContent=`Step ${wtIdx+1} of ${wtSteps.length} · ${s.title}`;
  document.getElementById('wtPrev').style.opacity=wtIdx===0?.3:1;
  document.getElementById('wtPrev').disabled=wtIdx===0;
  document.getElementById('wtNext').textContent=wtIdx===wtSteps.length-1?'Finish ✓':'Next →';
  wtSteps.forEach((_,i)=>{const p=document.getElementById('wp'+i);if(p)p.classList.toggle('on',i<=wtIdx);});
  if(wtVoiceOn) speakWt();
}
function speakWt(){
  const b=document.getElementById('wtVoiceBtn'); b.classList.add('speaking');
  speak(wtSteps[wtIdx].text,()=>b.classList.remove('speaking'));
}
function wtNav(dir){
  stopSpeech();
  if(dir===1&&wtIdx===wtSteps.length-1){closeWt();return;}
  wtIdx=Math.max(0,Math.min(wtSteps.length-1,wtIdx+dir));
  renderWt();
}
function closeWt(){stopSpeech();document.getElementById('wtOverlay').classList.remove('open');}
function toggleWtVoice(){
  wtVoiceOn=!wtVoiceOn;
  const b=document.getElementById('wtVoiceBtn');
  b.textContent=wtVoiceOn?'🔊':'🔇'; b.classList.remove('speaking');
  if(!wtVoiceOn) stopSpeech(); else speakWt();
}

/* ─── WEEKLY MODAL ──────────────────────────────── */
function openWeekly(){
  const w=new Date(),ws=new Date(w); ws.setDate(w.getDate()-6);
  document.getElementById('wm-week-label').textContent=ws.toLocaleDateString('en-US',{month:'long',day:'numeric'})+' – '+w.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const t=data[data.length-1];

  document.getElementById('wk-stats').innerHTML=[
    {l:'Avg readiness',v:avg(data,'readiness')+'/100',c:'var(--green)',n:avg(data,'readiness')>=80?'Strong recovery.':'Below optimal.'},
    {l:'Avg sleep',v:avgF(data,'sleep')+'h',c:'var(--purple)',n:avgF(data,'sleep')>=7?'Within recommended range.':'Below 7h minimum.'},
    {l:'Avg BP (sys)',v:avg(data,'bpSys')+' mmHg',c:'var(--pink)',n:avg(data,'bpSys')<130?'Healthy pressure.':'Elevated — monitor.'},
    {l:'Avg temperature',v:avgF(data,'temp')+'°C',c:'var(--amber)',n:'Baseline: '+t.tempBase+'°C'},
    {l:'Avg HRV',v:avg(data,'hrv')+' ms',c:'var(--green)',n:avg(data,'hrv')>=55?'Nervous system stable.':'Below baseline.'},
    {l:'Avg SpO₂',v:avgF(data,'spo2')+'%',c:'var(--cyan)',n:avgF(data,'spo2')>=96?'Oxygen healthy.':'Monitor for dips.'},
  ].map(s=>`<div class="wkstat"><div class="wkstat-label">${s.l}</div><div class="wkstat-val" style="color:${s.c}">${s.v}</div><div class="wkstat-note">${s.n}</div></div>`).join('');

  const best=data.reduce((b,d)=>d.sleep>b.sleep?d:b);
  document.getElementById('wk-insights').innerHTML=[
    {c:'',t:'Recovery driver',b:`Best recovery day (readiness ${data.reduce((b,d)=>d.readiness>b.readiness?d:b).readiness}/100) followed ${best.sleep}h sleep with ${best.deep}h deep. Sleep quality is the strongest driver of daily readiness.`},
    {c:avg(data,'bpSys')>=130?'warn':'',t:'Blood pressure trend',b:`Average systolic ${avg(data,'bpSys')} mmHg. ${avg(data,'bpSys')<130?'Healthy range.':'Elevated. Reduce sodium intake, increase hydration, add 30 minutes of walking.'}`},
    {c:data.some(d=>d.tempDev>0.5)?'warn':'',t:'Temperature watch',b:data.some(d=>d.tempDev>0.5)?`Temperature exceeded +0.5°C above baseline on ${data.filter(d=>d.tempDev>0.5).length} night(s). This is your ring's immune activation signal — watch for symptoms.`:`Temperature stayed within baseline all week. No inflammatory signals detected.`},
    {c:'',t:'Cardiovascular load',b:`HRV averaged ${avg(data,'hrv')}ms, RHR ${avg(data,'rhr')} BPM. ${avg(data,'hrv')>=55?'Both indicate healthy cardiovascular adaptation.':'HRV trending below optimal. Consistent bedtimes and reduced stimulants have the strongest evidence.'}`},
  ].map(p=>`<div class="insight ${p.c}"><div class="insight-title">${p.t}</div><div class="insight-body">${p.b}</div></div>`).join('');

  document.getElementById('wk-goals').innerHTML=[
    {l:'Daily steps',v:avg(data,'steps'),g:goals.steps||8000,fmt:v=>v.toLocaleString(),inv:false},
    {l:'Sleep duration',v:avgF(data,'sleep'),g:goals.sleep||7.5,fmt:v=>v+'h',inv:false},
    {l:'SpO₂ stability',v:avgF(data,'spo2'),g:goals.spo2||92,fmt:v=>v+'%',inv:false},
    {l:'Apnea events/night',v:+(data.reduce((s,d)=>s+d.apnea,0)/7).toFixed(1),g:goals.apnea||2,fmt:v=>v,inv:true},
  ].map(it=>{
    const p=it.inv?Math.max(0,Math.min(100,(1-it.v/it.g)*100)):Math.min(100,it.v/it.g*100);
    const col=p>=80?'var(--green)':p>=50?'var(--amber)':'var(--red)';
    return`<div class="goal-row"><div class="goal-label">${it.l}</div><div class="goal-bar"><div class="goal-fill" style="width:${Math.round(p)}%;background:${col};"></div></div><div class="goal-vals">${it.fmt(it.v)} / ${it.fmt(it.g)}</div></div>`;
  }).join('');

  const ec=document.getElementById('encounter-content');
  if(ec) ec.dataset.generated='';
  encTab('brief');
  document.getElementById('weeklyModal').style.display='flex';
}
function closeWeekly(){document.getElementById('weeklyModal').style.display='none';}

/* ─── ENCOUNTER TABS ────────────────────────────── */
function encTab(tab){
  ['brief','encounter','chat'].forEach(t=>{
    document.getElementById('epanel-'+t).classList.toggle('active',t===tab);
    document.getElementById('etab-'+t).classList.toggle('active',t===tab);
  });
  if(tab==='encounter') generateEncounter();
  if(tab==='chat') initSageChat();
}

async function generateEncounter(){
  const el=document.getElementById('encounter-content');
  if(el.dataset.generated==='1') return;
  el.innerHTML='<div class="enc-generating"><div class="enc-spinner"></div>Dr. Sage is reviewing your full history and generating your clinical encounter...</div>';
  const t=data[data.length-1],age=profile.age||48;
  const prevEnc=JSON.parse(localStorage.getItem('sh_encounters')||'[]');
  const openActs=JSON.parse(localStorage.getItem('sh_actions')||'[]').filter(a=>!a.done).map(a=>a.title);
  const prompt=`You are Dr. Sage generating a formal clinical encounter JSON. Be specific and evidence-based.

Patient: ${profile.name||'Frank'}, ${age}yo ${profile.sex||'Male'}, ${profile.weight||185}lbs. Conditions: ${profile.conditions||'None'}.
Prior encounters: ${prevEnc.length}. Open action items: ${openActs.join(', ')||'None'}.

This week's Wosheng TK30 biometrics:
- Readiness: ${avg(data,'readiness')}/100 | HRV: ${avg(data,'hrv')}ms | RHR: ${avg(data,'rhr')} BPM
- Blood pressure: ${avg(data,'bpSys')}/${avg(data,'bpDia')} mmHg (TK30 cuffless)
- Body temperature: ${avgF(data,'temp')}°C (baseline ${t.tempBase}°C, deviation ${t.tempDev>=0?'+':''}${t.tempDev}°C)
- Sleep: ${avgF(data,'sleep')}h avg | Deep: ${t.deep}h | REM: ${t.rem}h
- SpO₂: ${avgF(data,'spo2')}% | Apnea events: ${data.reduce((s,d)=>s+d.apnea,0)} this week
- Steps: ${avg(data,'steps').toLocaleString()}/day

Return ONLY valid JSON (no markdown):
{"chiefConcerns":["string"],"findings":[{"icon":"emoji","label":"string","value":"string","status":"normal|borderline|abnormal","interpretation":"string"}],"impression":"string","differentials":[{"condition":"string","likelihood":"low|possible|likely","rationale":"string"}],"orderedTests":[{"name":"string","priority":"urgent|routine|optional","reason":"string","how":"specific actionable patient instructions","category":"lab|imaging|wearable|referral"}],"plan":[{"step":"string","timeframe":"now|this week|this month|ongoing","rationale":"string"}],"followUp":"string","priorActionReview":"string"}`;

  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:2000,messages:[{role:'user',content:prompt}]})});
    const d=await res.json();
    const text=(d.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim();
    const enc=JSON.parse(text);
    renderEncounter(enc,el);
    saveEncounter(enc);
    el.dataset.generated='1';
  }catch(e){
    el.innerHTML=`<div style="color:var(--muted);font-size:13px;padding:14px 0;">Unable to generate encounter — check API configuration. Error: ${e.message}</div>`;
  }
}

function renderEncounter(enc,el){
  const ts=JSON.parse(localStorage.getItem('sh_test_status')||'{}');
  let h='';

  if(enc.chiefConcerns?.length||enc.findings?.length){
    h+=`<div class="enc-card">`;
    if(enc.chiefConcerns?.length){
      h+=`<div class="enc-label"><div class="enc-dot" style="background:var(--cyan)"></div>Chief concerns</div>`;
      h+=enc.chiefConcerns.map(c=>`<div class="enc-finding"><div style="font-size:14px;margin-top:1px;">◉</div><div class="enc-finding-body">${c}</div></div>`).join('');
    }
    if(enc.findings?.length){
      h+=`<div class="enc-label" style="margin-top:14px;"><div class="enc-dot" style="background:var(--green)"></div>Clinical findings</div>`;
      h+=enc.findings.map(f=>{
        const col=f.status==='normal'?'var(--green)':f.status==='borderline'?'var(--amber)':'var(--red)';
        return`<div class="enc-finding"><div style="font-size:15px;margin-top:1px;">${f.icon}</div><div class="enc-finding-body"><strong>${f.label}: <span style="color:${col}">${f.value}</span></strong><span class="enc-sub">${f.interpretation}</span></div></div>`;
      }).join('');
    }
    if(enc.impression) h+=`<div style="margin-top:14px;font-size:13px;line-height:1.75;color:#8296b8;background:rgba(155,114,245,.05);border-left:2px solid var(--purple);padding:10px 14px;border-radius:0 8px 8px 0;">${enc.impression}</div>`;
    h+=`</div>`;
  }

  if(enc.orderedTests?.length){
    h+=`<div style="margin-bottom:14px;"><div class="enc-label"><div class="enc-dot" style="background:var(--red)"></div>Tests &amp; referrals ordered</div>`;
    h+=enc.orderedTests.map((test,i)=>{
      const key=`t_${i}_${test.name.replace(/\W/g,'_')}`;
      const done=ts[key]||false;
      return`<div class="test-order" style="${done?'opacity:.5':''}"><span class="test-pri pri-${test.priority}">${test.priority}</span><div style="flex:1;"><div class="test-name" style="${done?'text-decoration:line-through;color:var(--muted)':''}">${test.name}</div><div class="test-reason">${test.reason}</div><div class="test-how">📋 ${test.how}</div></div><div style="flex-shrink:0;padding-top:2px;"><input type="checkbox" ${done?'checked':''} onchange="markTest('${key}',this.checked)"></div></div>`;
    }).join('');
    h+=`</div>`;
  }

  if(enc.plan?.length){
    h+=`<div class="enc-card"><div class="enc-label"><div class="enc-dot" style="background:var(--green)"></div>Management plan</div>`;
    h+=enc.plan.map((p,i)=>`<div class="plan-item"><div class="plan-num">${i+1}</div><div class="plan-text"><strong>${p.step}</strong><span class="plan-timeframe">⏱ ${p.timeframe} · ${p.rationale}</span></div></div>`).join('');
    h+=`</div>`;
  }

  if(enc.priorActionReview) h+=`<div style="background:rgba(0,184,217,.05);border:1px solid rgba(0,184,217,.14);border-radius:8px;padding:10px 13px;font-size:12px;color:#a5f3fc;line-height:1.6;margin-bottom:10px;">📂 <strong>Prior review:</strong> ${enc.priorActionReview}</div>`;
  if(enc.followUp) h+=`<div style="background:rgba(0,214,143,.05);border:1px solid rgba(0,214,143,.14);border-radius:8px;padding:10px 13px;font-size:12px;color:var(--green);line-height:1.6;margin-bottom:10px;">📅 <strong>Follow-up:</strong> ${enc.followUp}</div>`;
  h+=`<div class="enc-disclaimer">⚠ AI wellness advisor — not a medical diagnosis. Not a substitute for a licensed physician. In an emergency call 911.</div>`;
  el.innerHTML=h;
}
function markTest(key,checked){
  const ts=JSON.parse(localStorage.getItem('sh_test_status')||'{}');
  ts[key]=checked;
  localStorage.setItem('sh_test_status',JSON.stringify(ts));
}
function saveEncounter(enc){
  const encs=JSON.parse(localStorage.getItem('sh_encounters')||'[]');
  encs.unshift({date:new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),enc,scores:{readiness:avg(data,'readiness'),hrv:avg(data,'hrv'),rhr:avg(data,'rhr'),sleep:avgF(data,'sleep')}});
  localStorage.setItem('sh_encounters',JSON.stringify(encs.slice(0,20)));
  if(enc.plan?.length){
    const ex=JSON.parse(localStorage.getItem('sh_actions')||'[]');
    const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const ni=enc.plan.map(p=>({id:Date.now()+Math.random(),title:p.step,desc:p.rationale+' ('+p.timeframe+')',tag:'general',done:false,autoCheck:false,evidence:null,dateAssigned:date}));
    localStorage.setItem('sh_actions',JSON.stringify([...ni,...ex]));
  }
  populateHistory();
  showToast('📋 Clinical encounter saved',`${enc.plan?.length||0} action items added.`);
}

/* ─── DR SAGE CHAT ──────────────────────────────── */
function initSageChat(){
  chatMessages=[];
  document.getElementById('chatArea').innerHTML='';
  const t=data[data.length-1],name=profile.name||'Frank';
  const prevEnc=JSON.parse(localStorage.getItem('sh_encounters')||'[]');
  const openActs=JSON.parse(localStorage.getItem('sh_actions')||'[]').filter(a=>!a.done).map(a=>a.title);
  const histCtx=prevEnc.length>0?`${prevEnc.length} prior encounter(s). Last (${prevEnc[0].date}): "${prevEnc[0].enc?.impression?.slice(0,80)||''}". Open items: ${openActs.slice(0,3).join(', ')||'none'}.`:'First encounter.';
  const opening=`Good ${new Date().getHours()<12?'morning':'afternoon'}, ${name}. I've reviewed your TK30 data. ${histCtx} Readiness ${avg(data,'readiness')}/100, HRV ${avg(data,'hrv')}ms, BP ${t.bpSys}/${t.bpDia}, temp ${t.temp}°C (${t.tempDev>=0?'+':''}${t.tempDev}°C from baseline).${t.tempDev>0.4?' I want to discuss the temperature elevation.':''} What questions do you have?`;
  chatMessages.push({role:'assistant',content:opening});
  addBubble('sage',opening);
}
function addBubble(who,text){
  const a=document.getElementById('chatArea'),d=document.createElement('div');
  d.className='chat-msg'+(who==='user'?' user':'');
  d.innerHTML=`<div class="chat-av ${who==='sage'?'sage':'you'}">${who==='sage'?'🧠':(profile.name||'F')[0].toUpperCase()}</div><div class="chat-bubble">${text}</div>`;
  a.appendChild(d); a.scrollTop=a.scrollHeight;
}
function showTyping(){
  const a=document.getElementById('chatArea'),d=document.createElement('div');
  d.className='chat-msg'; d.id='typing';
  d.innerHTML=`<div class="chat-av sage">🧠</div><div class="chat-bubble"><div class="typing"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>`;
  a.appendChild(d); a.scrollTop=a.scrollHeight;
}
function removeTyping(){const t=document.getElementById('typing');if(t)t.remove();}
async function sendChat(){
  const inp=document.getElementById('chatInput'),msg=inp.value.trim();
  if(!msg) return;
  inp.value=''; document.getElementById('chatSendBtn').disabled=true;
  addBubble('user',msg); chatMessages.push({role:'user',content:msg}); showTyping();
  const t=data[data.length-1];
  const prevEnc=JSON.parse(localStorage.getItem('sh_encounters')||'[]');
  const openActs=JSON.parse(localStorage.getItem('sh_actions')||'[]').filter(a=>!a.done).map(a=>a.title);
  const sys=`You are Dr. Sage, AI clinical advisor in SageHealth. Precise, evidence-based, direct. Patient uses a Wosheng TK30 ring with ECG, BP, temperature, SpO₂, HRV, sleep, and activity sensors.

You NEVER diagnose or prescribe. You interpret biometric trends and help the patient understand their data. Refer to a licensed physician when clinically significant.

Patient: ${profile.name||'Frank'}, ${profile.age||48}yo ${profile.sex||'Male'}, ${profile.weight||185}lbs. Conditions: ${profile.conditions||'None'}.
Prior encounters: ${prevEnc.length}. Open items: ${openActs.join(', ')||'None'}.

Current TK30 biometrics:
Readiness ${avg(data,'readiness')}/100 | HRV ${avg(data,'hrv')}ms | RHR ${avg(data,'rhr')} BPM
BP ${t.bpSys}/${t.bpDia} mmHg | Temp ${t.temp}°C (${t.tempDev>=0?'+':''}${t.tempDev}°C baseline)
Sleep ${avgF(data,'sleep')}h avg | Deep ${t.deep}h | REM ${t.rem}h
SpO₂ ${avgF(data,'spo2')}% | Apnea ${data.reduce((s,d)=>s+d.apnea,0)} events/week
Steps ${avg(data,'steps').toLocaleString()}/day

Style: plain English, interpret before advising, 4–6 sentences, end with one targeted follow-up question.`;
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1000,system:sys,messages:chatMessages})});
    const d=await res.json();
    removeTyping();
    const reply=d.content?.[0]?.text||'Connection issue — please try again.';
    chatMessages.push({role:'assistant',content:reply}); addBubble('sage',reply);
    if(voiceOn) speak(reply);
    if(/wrap|done|bye|thank|finish/i.test(msg)) saveConsultation(reply);
  }catch(e){
    removeTyping(); addBubble('sage','Connection issue — please check your configuration.');
  }
  document.getElementById('chatSendBtn').disabled=false;
}
function saveConsultation(assessment){
  const entry={date:new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),assessment,scores:{readiness:avg(data,'readiness'),sleep:avgF(data,'sleep'),hrv:avg(data,'hrv'),airway:avg(data,'readiness')}};
  consultHistory.unshift(entry);
  localStorage.setItem('sh_history',JSON.stringify(consultHistory));
  const tr=JSON.parse(localStorage.getItem('sh_transcripts')||'[]');
  tr.unshift({date:entry.date,messages:[...chatMessages],scores:entry.scores});
  localStorage.setItem('sh_transcripts',JSON.stringify(tr));
  const ex=JSON.parse(localStorage.getItem('sh_actions')||'[]');
  const ni=extractActions(assessment,chatMessages);
  localStorage.setItem('sh_actions',JSON.stringify([...ni,...ex]));
  populateHistory();
  showToast('📋 Consultation saved',`${ni.length} action items assigned.`);
}
function extractActions(assessment,log){
  const templates=[
    {p:/side.?sleep|sleep.*side/i,title:'Sleep on your side',desc:'Reduces airway compression and apnea events.',tag:'airway'},
    {p:/alcohol/i,title:'Reduce evening alcohol',desc:'Avoid within 3h of bed — suppresses deep sleep and relaxes airway.',tag:'sleep'},
    {p:/walk|step|movement/i,title:'Hit daily step goal',desc:`Target ${(goals.steps||8000).toLocaleString()} steps/day.`,tag:'activity'},
    {p:/bedtime|consistent.*sleep/i,title:'Consistent bedtime',desc:'Same bedtime ±30 min — highest-impact sleep intervention.',tag:'sleep'},
    {p:/blood pressure|hypertension|sodium/i,title:'Monitor blood pressure trend',desc:'Check daily BP trend. Reduce sodium, increase water intake.',tag:'bp'},
    {p:/temperature|fever|illness/i,title:'Track temperature trend',desc:'Log morning temp for 5 days — watch for sustained elevation above baseline.',tag:'temp'},
    {p:/doctor|physician|medical/i,title:'See your doctor',desc:'Dr. Sage flagged something worth discussing with a licensed physician.',tag:'general'},
    {p:/hrv|stress|recovery/i,title:'Monitor HRV trend',desc:'Three consecutive days below baseline warrants recovery focus.',tag:'heart'},
  ];
  const all=[...log.map(m=>m.content),assessment].join(' ');
  const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const found=templates.filter(t=>t.p.test(all)).map(t=>({id:Date.now()+Math.random(),title:t.title,desc:t.desc,tag:t.tag,done:false,autoCheck:false,evidence:null,dateAssigned:date}));
  found.push({id:Date.now()+.5,title:'Review next week with Dr. Sage',desc:'Monday follow-up consultation.',tag:'general',done:false,autoCheck:false,evidence:null,dateAssigned:date});
  return found;
}

/* ─── RECORDS ───────────────────────────────────── */
function switchTab(tab){
  ['actions','encounters','transcripts','assessments'].forEach(t=>{
    document.getElementById('historyTab-'+t).style.display=t===tab?'block':'none';
    const b=document.getElementById('tab-'+t); if(b) b.classList.toggle('active',t===tab);
  });
}
function toggleTranscript(i){
  const b=document.getElementById('tb'+i),a=document.getElementById('ta'+i);
  if(b){const o=b.classList.toggle('open');if(a)a.textContent=o?'▲':'▼';}
}
function toggleEncounter(i){
  const b=document.getElementById('henc'+i);
  if(b){const o=b.classList.toggle('open');const btn=document.getElementById('hebtn'+i);if(btn)btn.textContent=o?'▲ collapse':'▼ expand';}
}
function toggleAction(id){
  const items=JSON.parse(localStorage.getItem('sh_actions')||'[]');
  const i=items.findIndex(x=>String(x.id)===String(id));
  if(i>=0&&!items[i].autoCheck){items[i].done=!items[i].done;localStorage.setItem('sh_actions',JSON.stringify(items));populateHistory();}
}
function populateHistory(){
  const stored=localStorage.getItem('sh_history'); if(stored) consultHistory=JSON.parse(stored);
  const actions=JSON.parse(localStorage.getItem('sh_actions')||'[]');
  const al=document.getElementById('action-items-list'),ae=document.getElementById('action-empty');
  if(!actions.length){if(al)al.innerHTML='';if(ae)ae.style.display='block';}
  else{
    if(ae) ae.style.display='none';
    const open=actions.filter(a=>!a.done),done=actions.filter(a=>a.done);
    let html='';
    if(open.length){
      html+=`<div class="sec-label">Open (${open.length})</div>`;
      html+=open.map(a=>`<div class="action-card"><div class="ac-check" onclick="toggleAction(${a.id})"></div><div><div class="ac-title">${a.title}</div><div class="ac-desc">${a.desc}</div><div class="ac-meta"><span class="ac-tag tag-${a.tag}">${a.tag}</span><span class="ac-date">Assigned ${a.dateAssigned}</span></div></div></div>`).join('');
    }
    if(done.length){
      html+=`<div class="sec-label">Completed (${done.length})</div>`;
      html+=done.map(a=>`<div class="action-card done"><div class="ac-check ${a.autoCheck?'auto':'checked'}" onclick="toggleAction(${a.id})">✓</div><div><div class="ac-title">${a.title}</div><div class="ac-desc">${a.desc}</div>${a.evidence?`<div style="font-size:11px;color:var(--cyan);margin-top:4px;">✓ ${a.evidence}</div>`:''}<div class="ac-meta"><span class="ac-tag tag-${a.tag}">${a.tag}</span><span class="ac-date">${a.dateAssigned}</span></div></div></div>`).join('');
    }
    if(al) al.innerHTML=html;
  }

  const tr=JSON.parse(localStorage.getItem('sh_transcripts')||'[]');
  const tl=document.getElementById('transcript-list'),te=document.getElementById('transcript-empty');
  if(!tr.length){if(tl)tl.innerHTML='';if(te)te.style.display='block';}
  else{
    if(te) te.style.display='none';
    if(tl) tl.innerHTML=tr.map((t,i)=>`<div class="transcript-card"><div class="tc-head" onclick="toggleTranscript(${i})"><div><div class="tc-date">Consultation · ${t.date}</div><div class="tc-prev">${t.messages.length} messages · Readiness ${t.scores.readiness}/100</div></div><span id="ta${i}">▼</span></div><div class="tc-body" id="tb${i}">${t.messages.map(m=>`<div class="t-msg ${m.role==='user'?'user':''}"><div class="t-av ${m.role==='user'?'you':'sage'}">${m.role==='user'?(profile.name||'F')[0].toUpperCase():'🧠'}</div><div class="t-bubble">${m.content}</div></div>`).join('')}</div></div>`).join('');
  }

  const encs=JSON.parse(localStorage.getItem('sh_encounters')||'[]');
  const enl=document.getElementById('encounter-list'),ene=document.getElementById('encounter-empty');
  if(!encs.length){if(enl)enl.innerHTML='';if(ene)ene.style.display='block';}
  else{
    if(ene) ene.style.display='none';
    if(enl) enl.innerHTML=encs.map((e,i)=>`<div class="he"><div class="he-head"><div><div style="font-size:11px;color:var(--muted);">${e.date}</div><div style="font-size:13px;font-weight:600;">Clinical encounter · Readiness ${e.scores.readiness}/100</div></div><button class="he-expand" id="hebtn${i}" onclick="toggleEncounter(${i})">▼ expand</button></div><div style="font-size:12px;color:var(--muted);margin-top:4px;">${(e.enc?.impression||'').slice(0,100)}...</div><div class="he-body" id="henc${i}"><div style="font-size:13px;color:#7a92b5;line-height:1.7;margin-bottom:9px;">${e.enc?.impression||''}</div>${e.enc?.plan?.length?`<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:9px 0 6px;font-weight:600;">Plan</div>`+e.enc.plan.map((p,j)=>`<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">${j+1}. ${p.step} <span style="color:var(--muted);">(${p.timeframe})</span></div>`).join(''):''}}</div></div>`).join('');
  }

  const hl=document.getElementById('history-list'),he=document.getElementById('assessment-empty');
  if(!consultHistory.length){if(hl)hl.innerHTML='';if(he)he.style.display='block';}
  else{
    if(he) he.style.display='none';
    if(hl) hl.innerHTML=consultHistory.map(h=>`<div class="hc"><div class="hc-date">${h.date}</div><div style="font-size:13px;font-weight:600;">Weekly assessment — Dr. Sage</div><div class="hc-body">${h.assessment}</div><div class="hc-scores"><span class="hc-score" style="color:var(--green)">Readiness ${h.scores.readiness}</span><span class="hc-score" style="color:var(--purple)">Sleep ${h.scores.sleep}h</span><span class="hc-score" style="color:var(--cyan)">HRV ${h.scores.hrv}ms</span></div></div>`).join('');
  }
}

/* ─── SETTINGS ──────────────────────────────────── */
function populateSettings(){
  document.getElementById('s_name').value=profile.name||'';
  document.getElementById('s_age').value=profile.age||'';
  document.getElementById('s_weight').value=profile.weight||'';
  document.getElementById('s_height').value=profile.height||'';
  document.getElementById('s_sex').value=profile.sex||'Male';
  document.getElementById('s_conditions').value=profile.conditions||'';
  document.getElementById('s_steps').value=goals.steps||8000;
  document.getElementById('s_sleep').value=goals.sleep||7.5;
  document.getElementById('s_apnea').value=goals.apnea||2;
  document.getElementById('s_spo2').value=goals.spo2||92;
}
function saveSettings(){
  profile={name:document.getElementById('s_name').value,age:parseInt(document.getElementById('s_age').value),weight:parseInt(document.getElementById('s_weight').value),height:parseFloat(document.getElementById('s_height').value),sex:document.getElementById('s_sex').value,conditions:document.getElementById('s_conditions').value};
  goals={steps:parseInt(document.getElementById('s_steps').value),sleep:parseFloat(document.getElementById('s_sleep').value),apnea:parseInt(document.getElementById('s_apnea').value),spo2:parseInt(document.getElementById('s_spo2').value)};
  localStorage.setItem('sh_profile',JSON.stringify(profile));
  localStorage.setItem('sh_goals',JSON.stringify(goals));
  setGreeting();
  showToast('✓ Saved','Settings updated.');
}

/* ─── NAV ───────────────────────────────────────── */
function showPage(id,el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if(el) el.classList.add('active');
}
function navToPage(id){
  const items=document.querySelectorAll('.nav-item');
  const map={dashboard:0,heart:1,sleep:2,vitals:3,activity:4,records:5,settings:6};
  showPage(id,items[map[id]]);
}

/* ─── TOAST ─────────────────────────────────────── */
function showToast(title,body){
  document.getElementById('toastTitle').textContent=title;
  document.getElementById('toastBody').textContent=body;
  const t=document.getElementById('toast');
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),5000);
}

/* ─── BOOT ──────────────────────────────────────── */
window.addEventListener('load',()=>{
  const sp=localStorage.getItem('sh_profile'),sg=localStorage.getItem('sh_goals');
  if(sp&&sg){profile=JSON.parse(sp);goals=JSON.parse(sg);initApp();}
});
