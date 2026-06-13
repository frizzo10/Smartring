/* ─────────────────────────────────────────────────────
   SageHealth — Doctor Report PDF Generator
   POST { stateMap, profile, signals, commitments }
   Returns PDF as base64

   Uses Groq to generate clinical narrative,
   then Python (via child_process) to render PDF.
   ───────────────────────────────────────────────────── */

const { execSync } = require('child_process');
const path = require('path');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { stateMap, profile, signals, commitments, reportDate } = body;

  // ── Step 1: Generate clinical narrative via Groq ──
  const groqKey = process.env.GROQ_API_KEY;
  let narrative = '';

  if (groqKey && stateMap) {
    try {
      const prompt = buildClinicalPrompt(stateMap, profile, signals, commitments);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 800,
          temperature: 0.3,
          messages: [
            { role: 'system', content: 'You are a clinical documentation assistant. Write concise, precise clinical summaries for physician review. Use medical terminology appropriately. Never diagnose — only report observations and patterns.' },
            { role: 'user', content: prompt }
          ]
        })
      });
      const data = await res.json();
      narrative = data.choices?.[0]?.message?.content || '';
    } catch(e) {
      console.log('Groq narrative failed:', e.message);
    }
  }

  // ── Step 2: Generate PDF via Python inline ────────
  const pythonScript = buildPythonScript(stateMap, profile, signals, commitments, narrative, reportDate);

  try {
    const result = execSync(`python3 -c "${pythonScript.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
      encoding: 'buffer',
      maxBuffer: 10 * 1024 * 1024
    });

    // Python prints base64 to stdout
    const base64 = result.toString('utf8').trim();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="SageHealth_Report_${(reportDate || new Date().toISOString().slice(0,10))}.pdf"`,
        'Cache-Control': 'no-cache'
      },
      body: base64,
      isBase64Encoded: true
    };

  } catch(e) {
    console.log('PDF generation error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'PDF generation failed', detail: e.message }) };
  }
};

/* ── BUILD CLINICAL PROMPT ─────────────────────────── */
function buildClinicalPrompt(stateMap, profile, signals, commitments) {
  const m = stateMap;
  const activeSignals = (signals || []).map(s => `${s.title} [${s.level}]`).join(', ') || 'None';
  const activeCommitments = (commitments || []).filter(c => c.status === 'active').map(c => c.commitment).join('; ') || 'None';

  return `Generate a concise clinical summary for a physician office visit. This patient uses a continuous biometric monitoring ring (Wosheng TK30).

PATIENT: ${profile?.age || '--'}yo ${profile?.sex || 'Unknown'} | Conditions: ${profile?.conditions || 'None reported'} | Medications: ${profile?.medications || 'None reported'}

7-DAY BIOMETRIC SUMMARY:
- HRV: ${m?.cardio?.hrv?.current || '--'}ms (age norm ${m?.cardio?.hrv?.age_norm || '--'}ms, status: ${m?.cardio?.hrv?.status || '--'}, trend: ${m?.cardio?.hrv?.trend?.label || '--'})
- RHR: ${m?.cardio?.rhr?.current || '--'} BPM (status: ${m?.cardio?.rhr?.status || '--'}, trend: ${m?.cardio?.rhr?.trend?.label || '--'})
- BP avg: ${m?.cardio?.bp?.systolic || '--'}/${m?.cardio?.bp?.diastolic || '--'} mmHg (${m?.cardio?.bp?.days_elevated || 0}/7 days elevated, trend: ${m?.cardio?.bp?.trend?.label || '--'})
- SpO2: ${m?.cardio?.spo2?.current || '--'}% (status: ${m?.cardio?.spo2?.status || '--'})
- Sleep: ${m?.sleep?.total?.avg7d || '--'}h total, ${m?.sleep?.deep?.avg7d || '--'}h deep, ${m?.sleep?.rem?.avg7d || '--'}h REM
- Overnight temp: ${m?.temperature?.last_night_f || '--'}°F (${m?.temperature?.deviation_f > 0 ? '+' : ''}${m?.temperature?.deviation_f || 0}°F from baseline)
- Steps: ${m?.activity?.steps_avg7d?.toLocaleString() || '--'}/day avg
- Health grade: ${m?.health_grade || '--'}

DETECTED PATTERNS: ${activeSignals}
PATIENT COMMITMENTS: ${activeCommitments}

Write a 3-paragraph clinical summary:
1. Overview of biometric trends and overall health picture (2-3 sentences)
2. Notable findings that warrant clinical attention, with specific values (2-3 sentences)
3. Suggested discussion points for this visit based on the data (2-3 sentences)

Use clinical language. Be specific with numbers. Do not diagnose. End with: "Data generated by SageHealth continuous biometric monitoring. This summary is for informational purposes and does not constitute medical advice."`;
}

/* ── BUILD PYTHON PDF SCRIPT ───────────────────────── */
function buildPythonScript(stateMap, profile, signals, commitments, narrative, reportDate) {
  const m = stateMap || {};
  const c = m.cardio || {};
  const s = m.sleep || {};
  const t = m.temperature || {};
  const a = m.activity || {};
  const r = m.recovery || {};
  const p = profile || {};
  const date = reportDate || new Date().toISOString().slice(0, 10);
  const patientName = p.name || 'Patient';
  const patientAge = p.age || '--';
  const patientSex = p.sex || '--';
  const conditions = p.conditions || 'None reported';
  const grade = m.health_grade || 'B';

  const activeSignals = (signals || []).map(s => `${s.title} (${s.level})`);
  const activeCommitments = (commitments || []).filter(c => c.status === 'active');

  // Escape for Python string
  const safeNarrative = (narrative || 'Clinical narrative not available.')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');

  const signalsList = activeSignals.map(s => `'${s.replace(/'/g, "\\'")}'`).join(', ');
  const commitList = activeCommitments.map(c => `'${(c.commitment || '').replace(/'/g, "\\'").slice(0, 80)}'`).join(', ');

  return `
import base64, io, sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

W, H = letter
buf = io.BytesIO()
doc = SimpleDocTemplate(buf, pagesize=letter,
    topMargin=0.6*inch, bottomMargin=0.6*inch,
    leftMargin=0.75*inch, rightMargin=0.75*inch)

# Colors
BLUE      = colors.HexColor('#1D6FA4')
BLUE_LIGHT= colors.HexColor('#E8F4FD')
GREEN     = colors.HexColor('#0E9F6E')
GREEN_LIGHT=colors.HexColor('#ECFDF5')
AMBER     = colors.HexColor('#B45309')
AMBER_LIGHT=colors.HexColor('#FFFBEB')
RED       = colors.HexColor('#C0392B')
RED_LIGHT = colors.HexColor('#FFF5F5')
GREY      = colors.HexColor('#6B7F96')
GREY_LIGHT= colors.HexColor('#F0F4F8')
DARK      = colors.HexColor('#1A2535')
WHITE     = colors.white

styles = getSampleStyleSheet()
def style(name='Normal', size=10, color=DARK, bold=False, align=TA_LEFT, leading=None):
    return ParagraphStyle(name+str(size)+str(bold),
        parent=styles['Normal'], fontSize=size,
        textColor=color, fontName='Helvetica-Bold' if bold else 'Helvetica',
        alignment=align, leading=leading or size*1.4)

story = []

# ── HEADER ─────────────────────────────────────────────
header_data = [[
    Paragraph('<font color="#1D6FA4"><b>SageHealth</b></font><br/><font size="8" color="#6B7F96">Continuous Biometric Monitoring</font>', style('h', 12)),
    Paragraph('<b>PATIENT HEALTH REPORT</b><br/><font size="8" color="#6B7F96">For Physician Review</font>', style('h', 11, align=TA_CENTER)),
    Paragraph(f'<font size="8" color="#6B7F96">Report date: {date}<br/>Generated by SageHealth AI</font>', style('h', 8, align=TA_RIGHT))
]]
ht = Table(header_data, colWidths=[2.2*inch, 3.4*inch, 1.6*inch])
ht.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), BLUE_LIGHT),
    ('ROWBACKGROUNDS', (0,0), (-1,-1), [BLUE_LIGHT]),
    ('BOX', (0,0), (-1,-1), 0.5, BLUE),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('LEFTPADDING', (0,0), (-1,-1), 12),
    ('RIGHTPADDING', (0,0), (-1,-1), 12),
]))
story.append(ht)
story.append(Spacer(1, 10))

# ── PATIENT INFO ────────────────────────────────────────
patient_data = [
    ['Patient', '${patientName}', 'Age / Sex', '${patientAge}yo / ${patientSex}'],
    ['Conditions', '${conditions}', 'Health Grade', '${grade}'],
    ['Ring Device', 'Wosheng TK30 (BLE 5.0)', 'Data Period', '7-day analysis'],
]
pt = Table(patient_data, colWidths=[1.1*inch, 2.6*inch, 1.1*inch, 2.4*inch])
pt.setStyle(TableStyle([
    ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
    ('FONTNAME', (2,0), (2,-1), 'Helvetica-Bold'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('TEXTCOLOR', (0,0), (0,-1), BLUE),
    ('TEXTCOLOR', (2,0), (2,-1), BLUE),
    ('TEXTCOLOR', (1,0), (1,-1), DARK),
    ('TEXTCOLOR', (3,0), (3,-1), DARK),
    ('BACKGROUND', (0,0), (-1,-1), GREY_LIGHT),
    ('ROWBACKGROUNDS', (0,0), (-1,-1), [GREY_LIGHT, WHITE]),
    ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#D1D9E0')),
    ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor('#D1D9E0')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
]))
story.append(pt)
story.append(Spacer(1, 12))

# ── CLINICAL SUMMARY ────────────────────────────────────
story.append(Paragraph('Clinical Summary', style('s', 11, BLUE, True)))
story.append(Spacer(1, 4))
story.append(HRFlowable(width='100%', thickness=1, color=BLUE_LIGHT))
story.append(Spacer(1, 6))
for para in '${safeNarrative}'.split('\\\\n'):
    if para.strip():
        story.append(Paragraph(para.strip(), style('b', 9, DARK, leading=14)))
        story.append(Spacer(1, 4))
story.append(Spacer(1, 8))

# ── BIOMETRIC DASHBOARD ─────────────────────────────────
story.append(Paragraph('7-Day Biometric Summary', style('s', 11, BLUE, True)))
story.append(Spacer(1, 4))
story.append(HRFlowable(width='100%', thickness=1, color=BLUE_LIGHT))
story.append(Spacer(1, 6))

def status_color(status):
    if status in ['excellent','optimal','athletic','peak','goal_met']: return GREEN
    if status in ['healthy','normal','good','close']: return BLUE
    if status in ['elevated','below_norm','watch','moderate','below_goal']: return AMBER
    return RED

def metric_row(label, value, unit, status, trend='', note=''):
    col = status_color(status)
    return [
        Paragraph(f'<b>{label}</b>', style('m', 9, DARK, True)),
        Paragraph(f'<font color="#{col.hexval()[1:]}"><b>{value}</b></font> <font size="8" color="#6B7F96">{unit}</font>', style('m', 10)),
        Paragraph(f'<font size="8" color="#{col.hexval()[1:]}">{status.replace("_"," ").upper()}</font>', style('m', 8, align=TA_CENTER)),
        Paragraph(f'<font size="8" color="#6B7F96">{trend}</font>', style('m', 8)),
        Paragraph(f'<font size="8" color="#6B7F96">{note}</font>', style('m', 8)),
    ]

hrv_c    = c.get('hrv', {})
rhr_c    = c.get('rhr', {})
bp_c     = c.get('bp', {})
spo2_c   = c.get('spo2', {})
sleep_t  = s.get('total', {})
sleep_d  = s.get('deep', {})
sleep_r  = s.get('rem', {})
act      = a

bio_header = [Paragraph('<b>Metric</b>', style('h',8,GREY,True)), Paragraph('<b>Value</b>', style('h',8,GREY,True)),
              Paragraph('<b>Status</b>', style('h',8,GREY,True,TA_CENTER)), Paragraph('<b>7-Day Trend</b>', style('h',8,GREY,True)),
              Paragraph('<b>Note</b>', style('h',8,GREY,True))]
bio_data = [bio_header]
bio_data.append(metric_row('Heart rate variability', str(hrv_c.get('current','--')), 'ms RMSSD', hrv_c.get('status','normal'),
    hrv_c.get('trend',{}).get('label','--'), f'Age norm {hrv_c.get("age_norm","--")}ms'))
bio_data.append(metric_row('Resting heart rate', str(rhr_c.get('current','--')), 'BPM', rhr_c.get('status','healthy'),
    rhr_c.get('trend',{}).get('label','--'), ''))
bio_data.append(metric_row('Blood pressure (avg)', f"{bp_c.get('systolic','--')}/{bp_c.get('diastolic','--')}", 'mmHg', bp_c.get('status','normal'),
    bp_c.get('trend',{}).get('label','--'), f"{bp_c.get('days_elevated',0)}/7 days elevated"))
bio_data.append(metric_row('Blood oxygen (SpO2)', str(spo2_c.get('current','--')), '%', spo2_c.get('status','excellent'),
    spo2_c.get('trend',{}).get('label','--'), 'Overnight avg'))
bio_data.append(metric_row('Total sleep', str(sleep_t.get('avg7d','--')), 'h avg', 'normal' if float(sleep_t.get('avg7d',0) or 0)>=7 else 'watch',
    sleep_t.get('trend',{}).get('label','--'), f"Goal {sleep_t.get('goal','7.5')}h"))
bio_data.append(metric_row('Deep sleep', str(sleep_d.get('avg7d','--')), 'h avg', 'normal' if float(sleep_d.get('avg7d',0) or 0)>=1.2 else 'watch',
    sleep_d.get('trend',{}).get('label','--'), 'Target 1.5h'))
bio_data.append(metric_row('REM sleep', str(sleep_r.get('avg7d','--')), 'h avg', 'normal' if float(sleep_r.get('avg7d',0) or 0)>=1.2 else 'watch',
    sleep_r.get('trend',{}).get('label','--'), 'Target 1.5h'))
bio_data.append(metric_row('Skin temperature', str(t.get('last_night_f','--')), 'F overnight', t.get('status','baseline').replace('_',' '),
    t.get('trend',{}).get('label','--'), f"+{t.get('deviation_f',0)}F from personal baseline"))
bio_data.append(metric_row('Daily steps', str(act.get('steps_avg7d') or '--'), '/day avg', act.get('status','normal'),
    act.get('trend',{}).get('label','--'), f"{act.get('goal_pct',0)}% of goal"))

bt = Table(bio_data, colWidths=[1.6*inch, 1.2*inch, 1.0*inch, 1.4*inch, 1.9*inch])
bt.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), BLUE),
    ('TEXTCOLOR', (0,0), (-1,0), WHITE),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [WHITE, GREY_LIGHT]),
    ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#D1D9E0')),
    ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor('#E2E8F0')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(bt)
story.append(Spacer(1, 12))

# ── DETECTED PATTERNS ───────────────────────────────────
sig_list = [${signalsList}]
if sig_list:
    story.append(Paragraph('Detected Patterns (for clinical review)', style('s', 11, BLUE, True)))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width='100%', thickness=1, color=BLUE_LIGHT))
    story.append(Spacer(1, 6))
    story.append(Paragraph('<i>The following patterns were detected by SageHealth algorithmic monitoring. These are observational findings that may warrant clinical discussion, not diagnoses.</i>',
        style('n', 8, GREY)))
    story.append(Spacer(1, 6))
    sig_data = []
    for sig in sig_list:
        level = 'URGENT' if 'urgent' in sig.lower() else 'WATCH' if 'watch' in sig.lower() else 'INFO'
        col = RED if level=='URGENT' else AMBER if level=='WATCH' else BLUE
        sig_data.append([
            Paragraph(f'<font color="#{col.hexval()[1:]}"><b>{level}</b></font>', style('sl', 8, align=TA_CENTER)),
            Paragraph(sig.replace(f' ({level.lower()})',''), style('sl', 9, DARK)),
        ])
    st = Table(sig_data, colWidths=[0.8*inch, 6.4*inch])
    st.setStyle(TableStyle([
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [WHITE, GREY_LIGHT]),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#D1D9E0')),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(st)
    story.append(Spacer(1, 12))

# ── PATIENT COMMITMENTS ─────────────────────────────────
commit_list = [${commitList}]
if commit_list:
    story.append(Paragraph('Patient Health Commitments', style('s', 11, BLUE, True)))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width='100%', thickness=1, color=BLUE_LIGHT))
    story.append(Spacer(1, 6))
    story.append(Paragraph('<i>These are commitments the patient made during voice consultations with SageHealth. Progress is tracked via biometric data.</i>',
        style('n', 8, GREY)))
    story.append(Spacer(1, 6))
    for i, com in enumerate(commit_list, 1):
        story.append(Paragraph(f'{i}. {com}', style('c', 9, DARK)))
        story.append(Spacer(1, 3))
    story.append(Spacer(1, 8))

# ── PHYSICIAN NOTES ─────────────────────────────────────
story.append(Paragraph('Physician Notes', style('s', 11, BLUE, True)))
story.append(Spacer(1, 4))
story.append(HRFlowable(width='100%', thickness=1, color=BLUE_LIGHT))
story.append(Spacer(1, 6))
notes_data = [[''] for _ in range(6)]
nt = Table(notes_data, colWidths=[7.2*inch], rowHeights=[0.38*inch]*6)
nt.setStyle(TableStyle([
    ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#D1D9E0')),
    ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor('#E2E8F0')),
    ('BACKGROUND', (0,0), (-1,-1), GREY_LIGHT),
]))
story.append(nt)
story.append(Spacer(1, 12))

# ── FOOTER ──────────────────────────────────────────────
story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#D1D9E0')))
story.append(Spacer(1, 4))
story.append(Paragraph(
    'SageHealth is a biometric monitoring and health concierge service. This report is for informational purposes only and does not constitute medical advice, diagnosis, or treatment. '
    'All findings should be reviewed by a licensed healthcare provider. Device: Wosheng TK30 Smart Ring. '
    f'Report generated: {date}.',
    style('f', 7, GREY, align=TA_CENTER)))

doc.build(story)
buf.seek(0)
print(base64.b64encode(buf.read()).decode(), end='')
`;
}
