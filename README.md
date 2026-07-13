# Ritmova — capture-motorn

Den sida som Ritmovas Android-app öppnar i en **Trusted Web Activity** (riktig Chrome-motor) för
att göra själva kamerafångsten. Sidan gör **bara capture**: `getUserMedia` → per-frame R/G/B-medel
→ gzip → tillbaka till native via deep-link. **All signalbehandling körs native i APK:n**
(peak-detektion, SQI, kvalitetsgate, HRV-mått) — ingen DSP-IP ligger i den här serverade JS:en.

> **Varför en webbsida mitt i en native app?** TWA renderar i Chrome-processen och får därmed
> `requestAnimationFrame` i full takt (~59 fps). Native `ImageAnalysis` är låst till 30 fps på
> S22+, och WebView stryps också till 30. Chrome-motorn var enda vägen till den tidsupplösning
> HRV kräver. Ficklampan tänds samtidigt av en native foreground-service (`setTorchMode`, **före**
> Chrome öppnar kameran) — den överlever att Chrome tar kameran. Bakgrunden finns i
> `HRVMonitor-android/CLAUDE.md`.

## Deploy

**GitHub Pages** på egen domän — `CNAME` pekar på `tryritmova.com`, och `.well-known/assetlinks.json`
på samma origin bär Digital Asset Links (som ger TWA:n fullskärm utan URL-fält).

⚠️ `netlify.toml` ligger kvar men **används inte**. Repot är dessutom **publikt** (medvetet: DSP:n är
skyddad genom att ligga native, så den serverade sidan bär inget känsligt).

⚠️ **Originet är oåterkalleligt vid Play-release** — det är bundet till assetlinks. Ändras det efter
release tappar TWA:n fullskärmen för alla installerade användare. Native har det på ett enda ställe:
`productize/CaptureSite.kt`.

## ⚠️ Cache-disciplin — läs innan du ändrar `index.html`

Service workern (`sw.js`) är **cache-first**. Ändrar du `index.html` **måste** du bumpa
`CACHE_VERSION` (`vN` → `vN+1`), annars sitter användaren kvar på den gamla cachade sidan för alltid.

Även med en bump slår ändringen igenom först vid **nästa** öppning — den nya service workern
installeras parallellt medan den redan laddade (gamla) sidan kör klart. Native måste därför tåla att
den *första* mätningen efter en deploy fortfarande kör den gamla sidan (se `sig` nedan).

## Kontraktet mot native

### In — vad launchern skickar (`CaptureSite.measureUrl`)

| Param | Betydelse |
|---|---|
| `t` | cache-buster; tvingar en färsk navigering så `window.load` fyrar → ny capture startar |
| `sig` | **mätningens biljett** (se nedan) |
| `dur` | mätlängd i sekunder (30 / 60 / 300) |
| `breath` | andningsguide av/på (`0`/`1`) |
| `bpat` | andningsmönster (`0`=Resonans `1`=4-7-8 `2`=Box) — styr bara det VISUELLA; haptiken ägs av native |
| `lang` | appens språk (`sv`/`en`) |
| `effect`, `estep` | effekt-flödets steg (1/2/3), ekas tillbaka |
| `prepare=camera` | HRR:s kamera-förkontroll → sidan begär bara behörighet och navigerar `ritmova://camera-ready` |

### Ut — vad sidan skickar tillbaka

```
hrvresult://raw?d=<base64url(gzip("R\nG\nB\nT"))>&n=&csum=&fps=&dur=[&effect&estep][&sig]
hrvresult://cancel[?sig]           ← avbruten mätning
```

`R`/`G`/`B` = per-frame kanalmedel (3 decimaler), `T` = relativ tid i ms. `csum` = summan av alla
tre kanalerna; native **gatar** på den — en trunkerad payload sparas aldrig som en mätning.

⚠️ `fps` skickas fortfarande men native **litar inte på den**: sidan räknar fps över de senaste 60
*accepterade* samplen, så ett fingerglapp kollapsar siffran. Native härleder i stället bildfrekvensen
ur medianen av frame-intervallen (`RawPayloadCodec.frameRateHz`).

### `sig` — mätningens biljett (**säkerhet**)

`hrvresult`-schemat **måste** vara exporterat och BROWSABLE (Chrome ska kunna avfyra det härifrån)
och har ingen värdrestriktion. Utan skydd kunde därför **vilken webbsida som helst** som användaren
besöker navigera till `hrvresult://done?rri=…` och få en **påhittad mätning auto-sparad i användarens
historik och i Health Connect**.

Native lottar därför ett engångstoken vid launch (`?sig=`), och den här sidan **ekar tillbaka det** i
både resultat- och avbryt-länken. Bryggan accepterar bara resultat vars token den själv delade ut.
Sidan ser aldrig något hemligt — token är bara ett kvitto på att capturen är appens egen.

## Vad sidan gör (och inte gör)

- **Capture:** `getUserMedia` (bakre kamera) → `<video>` (dold, 1×1 offscreen) → canvas 32×24 →
  central 24×16 ROI → R/G/B-medel per bildruta. Fingerdetektion: `R>100 && R>B·1.3 && R>G·1.05`.
- **Visar:** mät-ring, live-vågform, live-BPM och andningsguiden.
- **Live-BPM är en förhandsvisning, inte resultatet.** Den räknas med en enkel peak-räknare på den
  redan filtrerade display-signalen. Den auktoritativa pulsen — och all gating — räknas native på den
  råa strömmen. (Fryser skattningen faller siffran tillbaka till `--` i stället för att ljuga.)
- **Sparar inget, laddar inte upp något.** Ingen bild och ingen video lämnar sidan.
- **Avbrott är ärligt:** blir sidan dold (hemsvep/app-byte) släpps kameran → torchen släcks av native →
  mätningen är död. Sidan säger då det rakt ut och erbjuder en väg tillbaka, i stället för att låtsas
  mäta vidare och sedan skicka en trunkerad mätning.
