# Post-Firmware-Flash Roadmap

Everything on this list is blocked by one confirmed, measured fact: stock
firmware's raw sensor stream runs at **~1Hz** (measured live tonight — 61
samples over 59.8s). That's too slow to resolve individual heartbeats,
which is why every HRV capture attempt returned `too_few_beats`. This
isn't a code problem — no algorithm can find a beat in data that doesn't
contain one.

The fix, if we take it: flash `R02_3.00.06_FasterRawValuesMOD.bin` via
`https://atc1441.github.io/ATC_RF03_Writer.html` — a real, documented
community firmware mod built for exactly this. Real risk: third-party
firmware, no official recovery path, genuine bricking risk if the BLE
connection drops mid-flash. Not done yet — this document is the plan for
if/when it happens, not a record of it happening.

## Unlocked once sample rate is fast enough

1. **Real HRV (RMSSD)** — the original goal. Same math already built in
   `hrv.js`, just needs a sample rate that actually contains beats.
2. **More reliable raw captures generally** — fewer `too_few_beats` /
   `signal_too_noisy` failures across the board, not HRV-specific.
3. **Respiration rate estimate** — breathing modulates the PPG baseline.
   No ring command gives us this at all today; would be entirely new,
   derived from our own signal processing.
4. **Real motion-artifact detection** — faster accelerometer + faster PPG
   together lets us flag "this reading happened during movement, don't
   trust it" instead of guessing.
5. **Live PPG waveform view** — an actual pulse trace on screen. Useful
   as a diagnostic (confirm good ring contact before trusting a reading)
   and as a real-time visual.
6. **Independent SpO2 cross-check** — our own estimate computed from the
   raw red channel, not just trusting the ring's internal number.
7. **Pulse waveform shape analysis** — not just timing between beats but
   the shape of each one. Real technique, bigger build, longer-term.
8. **Dual-channel cross-validation** — green (HR) and red (SpO2) channels
   both pulse with each heartbeat. Running beat detection on both and
   cross-checking them against each other is a stronger, more robust
   signal than relying on the green channel alone.
9. **Perfusion Index** — established pulse-ox metric measuring blood flow
   strength at the sensor site (ratio of pulsatile to non-pulsatile
   signal). Our raw samples already carry max/min/diff per sample — the
   raw material for this already exists in what we capture, just needs
   fast-enough sampling to be meaningful. Doubles as a signal-quality
   check.
10. **Dicrotic notch detection** — the secondary bump after the main
    pulse peak, caused by the heart valve closing. A specific, documented
    waveform feature distinct from general shape analysis (#7).
11. **PPG-based signal quality scoring** — judges trustworthiness from the
    pulse signal's own beat-to-beat consistency, independent of the
    accelerometer-based motion detection in #4.
12. **Irregular pulse pattern flagging** — same category of thing Apple
    Watch / Fitbit do with PPG-derived beat-to-beat data: not a diagnosis,
    just "this pattern is worth having a doctor look at." Would use the
    same RR-interval extraction the HRV math already does, framed the
    same non-diagnostic way as everything else in this app.

## Explicitly ruled out — not a firmware problem, won't be fixed by this

- **ECG.** Confirmed via COLMI's own published spec sheet: this ring has
  one PPG sensor (Vcare VC30F) and one accelerometer (STK8321). No
  electrode-based bioelectric hardware exists. ECG measures electrical
  potential; PPG measures light absorption. Physically different sensing
  modalities — firmware cannot manufacture a sensor that isn't there.
- **True cuffless blood pressure.** Same PPG sensor, different wall: real
  pulse-wave-velocity BP needs two measurement sites (this ring has one),
  and even single-site waveform approaches need calibration against a
  real blood pressure cuff (we have none). Faster sampling gives a
  cleaner waveform, not a second site or a calibration reference.

## Status

Not yet flashed. Firmware mod identified, flashing tool identified, risks
understood. Next real step, whenever it happens: full battery, ring in a
known-clean state (not mid-session), flash, then re-measure sample rate
the same way we did tonight (samples ÷ duration) to confirm what we
actually got before building anything on top of it.
