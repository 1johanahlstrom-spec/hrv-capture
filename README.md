# HRV capture-motor (privat)

Capture-only-sida för native HRV-appen (productize/twa-chain). Kör BARA getUserMedia +
R/G/B-kanalmedel + gzip → skickar rå ström via `hrvresult://raw` → native APK kör ALL DSP.
Ingen DSP-IP i denna serverade JS (peak-detektion/SQI/gate ligger i APK:n).

Privat repo med flit: även om JS:en är minimal vill vi inte exponera källan publikt.
Deploy: Netlify (auto från denna main). dsp.js = paritet-referens (städas i utbyggnad).
