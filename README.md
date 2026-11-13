# Frana

Datamosh per video, **interamente nel browser**: nessun server, nessun caricamento. I video restano sul telefono.

## Pubblicare su GitHub Pages
1. Crea un repository **pubblico** su GitHub (per esempio `frana`). Con un account gratuito, Pages funziona solo con repository pubblici.
2. Carica tutti i file di questa cartella, compresa la cartella nascosta `.github`.
3. Su GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Il workflow parte a ogni push (oppure da **Actions → Pubblica Frana → Run workflow**). Scarica ffmpeg.wasm da npm e pubblica il sito.
5. L'indirizzo sarà `https://<tuo-utente>.github.io/<nome-repo>/`. Dal telefono: menu del browser → "Aggiungi a schermata Home".

## In locale
Servono Node 18+ e Python:
```
npm install
npm run vendor
npm run serve
```
Poi apri http://localhost:8080

## Come funziona
- `js/mosh.js`: ogni clip viene ricodificato in MPEG-4 part 2 con un solo keyframe (I-frame) e senza B-frame. Dal secondo clip in poi l'I-frame viene scartato, così il movimento del clip B si applica ai pixel del clip A. Gli stili (Bloom, Melt, Pulse, Shake, Corrupt) ripetono, mescolano o alterano quei P-frame. Il risultato viene riesportato in H.264/MP4.
- `js/engine.js`: carica ffmpeg.wasm (versione a un solo thread, l'unica possibile su GitHub Pages).
- "Rifai" riusa la parte lenta (decodifica dei clip) se non cambi file, durata, qualità o formato.

## Limiti
- Tutto gira sul telefono con ffmpeg a un solo thread: è più lento di un server. La prima volta scarica circa 30 MB di motore.
- Video 4K o HEVC (tipici degli iPhone) sono lenti da decodificare. Per iniziare usa 360p/480p e una durata per clip di 3-5 secondi.
- I browser mobili limitano la memoria: se la pagina si ricarica da sola durante l'elaborazione, riduci durata e qualità.
- Tieni lo schermo acceso durante l'elaborazione.

## Se qualcosa non va
- Il workflow fallisce al passo "Installa ffmpeg.wasm e prepara il sito": controlla le versioni dei pacchetti in `package.json`.
- La pagina dice che non riesce a caricare il motore: controlla che online esista la cartella `vendor/` (viene creata dal workflow).
