# SCRAPLINE — audit tecnico v0.1.0 → v0.1.1

Data: 5 novembre 2026. Ambito: networking, prestazioni client, sicurezza, build e deployment.
Il gioco non è stato riscritto; armi, mappe e interfaccia sono invariate (l'unica modifica visibile
è la scritta "Connection interrupted" nell'indicatore di rete e qualche riga in più nell'overlay di
debug). Nessun deployment pubblico e nessuna risorsa a pagamento.

## 1. Sintesi

| Esito | Dettaglio |
|---|---|
| "pending 190" | Riprodotto e spiegato: veniva da un processo server vecchio (pre-fix) rimasto attivo su 2567. Il codice corrente, nelle stesse condizioni, ha pending p95 = 0 (13 FPS) e 1 (60 FPS). |
| Difetti reali trovati e corretti | 7 di networking, 7 di sicurezza, 2 di deployment/operatività, 1 dello strumento di test (vedi §3). Ognuno ha un test che fallisce sul codice v0.1.0 e passa ora. |
| Verificato | Matrice netcode 15/15, E2E con due browser a 0/120/250 ms RTT con reload, stallo e caduta di connessione, 124 test unitari e di integrazione (PostgreSQL e TLS reali), build e avvio dell'immagine Docker. |
| Non verificato | 60 FPS su GPU reale (qui c'è solo rendering software), immagine Docker con la base ufficiale (registry bloccati), deploy reale su Render/Vercel. |

## 2. Ambiente e metodo

- VM cloud: 2 vCPU Intel Xeon, Ubuntu 24.04, Node 22.23, Chrome headless con **SwiftShader** (WebGL
  software, nessuna GPU), PostgreSQL 16 (un cluster normale e uno solo-TLS con CA privata).
- Strumenti creati per l'audit (restano nel repository):
  - metriche della pipeline di input su client (`NetMetrics`) e server (contatori per giocatore);
  - `apps/server/scripts/netaudit.ts`: due client headless che usano il codice di rete reale del
    client contro un server reale, attraverso il proxy, con criteri di accettazione espliciti;
  - `tests/tools/netem-proxy.mjs`: latenza, jitter, stalli, cadute, TLS, `X-Forwarded-For`,
    controllabile a runtime;
  - E2E Playwright con asserzioni sulla pipeline e un test reload/stallo/caduta;
  - `bench.html` + `tests/perf/run-bench.mjs`: benchmark client ripetibile senza server;
  - `tests/tools/pg-tls-setup.sh` e `apps/server/test/pgTls.test.ts`.
- Dati grezzi: `docs/audit/data/` (JSON della matrice prima/dopo, riproduzione legacy, benchmark).
- Il limite teorico di pending usato come criterio è
  ⌈(RTT + 2·jitter + 2·tick 50 ms + 2·frame) / 16,7 ms⌉ + 2 frame (vedi docs/TESTING.md).

## 3. Criticità

| ID | Area | Severità | Titolo | Stato |
|---|---|---|---|---|
| N1 | Rete | Alta (storica) | "pending 190": input elaborati al 22 % del tempo reale | Causa documentata, test di regressione |
| N2 | Rete | Alta | Dopo uno stallo uplink ≥ ~1 s il giocatore viene espulso (4002) | Corretto |
| N3 | Rete | Media | Coda di input stazionaria dopo stalli > 0,25 s (latenza permanente) | Corretto |
| N4 | Rete | Media | Il client scarta input non confermati oltre 240 | Corretto |
| N5 | Rete/UI | Alta | Dopo reload della pagina la scena non si collega alla stanza (gioco fermo) | Corretto |
| N6 | Rete | Media | Riconnessione con socket ancora aperto: giocatore espulso invece di riprendere il posto | Corretto |
| N7 | Rete | Bassa | Dopo la riconnessione automatica gli input bufferizzati dall'SDK arrivano fuori ordine | Corretto |
| N8 | Rete | Bassa | Ack del flusso precedente non azzerato in `onReconnect` (difensivo) | Corretto |
| N9 | Osservabilità | Media | Nessuna metrica della pipeline; "interp lag" mostrava una costante | Corretto |
| T1 | Test | Media | Il proxy di test poteva riordinare i frame | Corretto |
| S1 | Sicurezza | Alta | TLS PostgreSQL con `rejectUnauthorized: false` | Corretto |
| S2 | Sicurezza | Media | `sslmode` nell'URL sovrascrive le opzioni TLS | Corretto |
| S3 | Sicurezza | Alta | `trust proxy 1` fisso: `X-Forwarded-For` falsificabile, rate limit aggirabili | Corretto |
| S4 | Sicurezza | Alta | Creazione di stanze senza autenticazione (DoS) | Corretto |
| S5 | Sicurezza | Media | Matchmaking senza rate limit | Corretto |
| S6 | Sicurezza | Media | Token nei log quando annidati negli errori del framework | Corretto |
| S7 | Sicurezza | Bassa | Mappa del rate limiter senza limite di memoria | Corretto |
| S8 | Sicurezza | Bassa | `docker-compose.yml` con segreto in chiaro e DB esposto su tutte le interfacce | Corretto |
| D1 | Deploy | Bassa | Errore di avvio del DB non strutturato | Corretto |
| D2 | Deploy | Info | L'immagine runtime include `typescript` e `@types` (~35 MB) | Aperto (roadmap) |
| P1 | Prestazioni | — | 60 FPS mai misurati su GPU reale | Benchmark pronto, **dato mancante** |

### N1 — "pending 190" (Alta, storica)

- **Evidenza.** Patch di riproduzione `docs/audit/data/legacy-tick-repro.patch` (reintroduce il
  codice di tick del commit 5d1cd40) + `netaudit --only rtt0`:
  pending p50/p95/max **168/186/194**, server che elabora 13,3 input/s su 60, 657 input scartati in
  12 s, 85 correzioni (12 snap fino a 463 px), 7 colpi su 21 eseguiti
  (`data/netaudit-legacy-tick-5d1cd40.json`). Stesso scenario sul codice v0.1.0: pending p95 0–1,
  0 scarti, 0 correzioni (`data/netaudit-v0.1.0.json`).
- **Causa.** Impostare `patchRate = null` prima di `setTimestep` fa partire in Colyseus un intervallo
  extra a 60 Hz che chiama `clock.tick()`; il `deltaTime` passato al timestep misura quindi il tempo
  dall'ultimo tick di quell'intervallo (pochi ms) e non i 50 ms reali. La correzione in v0.1.0
  (misurare con `performance.now()`) era giusta, ma gli screenshot provenivano da un processo server
  avviato prima della correzione e mai terminato.
- **File.** `apps/server/src/rooms/ArenaRoom.ts`.
- **Modifica.** `patchRate = null` ora dopo `setTimestep`: l'intervallo extra non viene più creato
  (prima girava inutilmente in ogni stanza).
- **Test.** `room.integration.test.ts` › "advances the room clock only from the 20 Hz simulation
  tick": 82 tick/s con il codice v0.1.0, 20 ora.

### N2 — Espulsione dopo uno stallo uplink (Alta)

- **Evidenza.** `netaudit` scenari `stall-up-1000ms` e `stall-both-1500ms` su v0.1.0: entrambi i
  client chiusi con 4002, posto perso, stanza eliminata (log `player left` + `room disposed`).
- **Causa.** Durante uno stallo TCP il client accumula un messaggio per frame; alla ripresa arrivano
  tutti insieme. Colyseus conta i messaggi in finestre di 1 s e chiude il client oltre
  `maxMessagesPerSecond` (90); `onDrop` non trattiene il posto per 4002.
- **File.** `packages/shared/src/config/game.ts`, `apps/web/src/game/scenes/ArenaScene.ts`,
  `apps/web/src/game/net/metrics.ts`.
- **Modifica.** Guardia di stallo sul client (N4) che limita il burst a ≤ 45 messaggi; limite server
  a 150/s (traffico normale misurato ~61/s + burst 45 = ~106).
- **Test.** `room.integration.test.ts` › "tolerates the input burst … but disconnects a flooder"
  (fallisce con 90, passa con 150; un client che invia 400 messaggi di fila viene ancora espulso).
- **Prima/dopo.** `stall-up-1000ms`: espulsione → 0 correzioni, recupero in 560 ms;
  `stall-both-1500ms`: espulsione → 0 correzioni, recupero 568 ms.

### N3 — Coda stazionaria dopo uno stallo (Media)

- **Evidenza.** v0.1.0, `stall-up-400ms`: coda server di 8 frame per tutto il resto della sessione
  (pending p50 passa da 3 a 9 = +100 ms di latenza di input permanente). Con stalli più lunghi la
  coda arrivava al limite di 60 (fino a +1 s).
- **Causa.** Il credito di input matura al ritmo reale e gli arrivi pure, quindi una coda formatasi
  oltre la "banca" di 0,25 s non si svuota mai.
- **File.** `apps/server/src/simulation/GameSimulation.ts`, `packages/shared/src/config/game.ts`.
- **Modifica.** Banca = guardia client (0,75 s), consumo dell'arretrato fino a 2× il tempo reale
  (niente teletrasporti visibili agli altri), taglio della coda se per 1 s non scende mai sotto
  2 frame, coda piena che scarta i frame più vecchi. Il comando di cambio arma non va perso.
- **Test.** `simulation.test.ts`: stallo di 0,7 s applicato senza scarti; arretrato irriducibile
  tagliato; flood a 2× il ritmo limitato a tempo reale + 0,75 s; cambio arma preservato.
- **Prima/dopo.** `stall-up-400ms` coda residua 8 → 2, 0 correzioni.
- **Compromesso misurato.** Un client modificato può anticipare al massimo 0,75 s di movimento
  (prima 0,25 s) e lo esegue a velocità doppia: è il classico "lag switch", limitato e visibile.
  A 250 ms di RTT uno stallo di 1,5 s costa 5–6 frame scartati e una correzione di ~27 px sfumata
  (`stall-up-1500ms-rtt250`).

### N4 — Input non confermati scartati oltre 240 (Media)

- **Evidenza.** Con 240 frame senza ack il `Predictor` eliminava i più vecchi; il replay successivo
  partiva dall'ack con un buco, quindi la predizione era sbagliata per costruzione (e nella
  riproduzione N1 contribuiva alle 85 correzioni).
- **File.** `apps/web/src/game/net/Predictor.ts`, `ArenaScene.ts`, `metrics.ts`, `InGame.tsx`,
  `hudStore.ts`.
- **Modifica.** Nessuno scarto. Se ci sono input in sospeso e l'ack non avanza da 750 ms, il client
  smette di generare input e mostra "Connection interrupted"; riparte appena l'ack si muove.
  750 ms = ~2,5× il peggior intervallo tra ack misurato in gioco normale (292 ms con 120 ms RTT,
  30 ms jitter e stalli all'1 %). Costo del replay misurato: 0,07 ms con 20–60 input in sospeso,
  0,4 ms con 900.
- **Test.** `netcode.test.ts` › 600 input senza ack, convergenza esatta; guardia che scatta solo con
  input in sospeso e si rilascia all'ack. E2E: la scritta compare durante uno stallo di 1,5 s e
  sparisce dopo.

### N5 — Reload della pagina: gioco fermo (Alta)

- **Evidenza.** Il nuovo test E2E (reload in partita) fallisce deterministicamente sul codice
  precedente: HUD visibile, ma la scena Phaser non riceve mai la stanza (`phase()` resta null per
  20 s). Riproducibile anche aprendo un link d'invito su un dispositivo lento.
- **Causa.** Ripresa della sessione e link d'invito partono appena il profilo è caricato, mentre
  Phaser è ancora in avvio; l'evento `roomChanged` arriva prima che la scena si iscriva.
- **File.** `apps/web/src/game/scenes/ArenaScene.ts`.
- **Modifica.** In `create()` la scena prende la stanza corrente da `session.room`.
- **Test.** `tests/e2e/netcode.spec.ts` (reload, poi movimento visto dall'altro browser, convergenza
  esatta, nessun ack obsoleto) a 0, 120 e 250 ms di RTT.

### N6 — Riconnessione con socket ancora aperto (Media)

- **Evidenza.** Presentando il token di riconnessione di un client ancora connesso (succede dopo un
  cambio di rete prima che il server se ne accorga) il vecchio socket veniva chiuso con 4002, il
  posto non trattenuto e la riconnessione falliva con "seat reservation expired".
- **Causa.** Colyseus chiude il vecchio socket con `WITH_ERROR`; `onDrop` interpretava quel codice
  come violazione di protocollo.
- **File.** `apps/server/src/rooms/ArenaRoom.ts` (`checkReconnectionToken`, `onDrop`).
- **Test.** `room.integration.test.ts` › "moves the seat to a new connection that presents the live
  token": stessa sessione, stato conservato, vecchio socket chiuso, nessun duplicato.
- **Nota.** Il token di riconnessione resta una credenziale al portatore (modello Colyseus): chi lo
  possiede prende il posto. Non viene mai scritto nei log (S6).

### N7 — Input fuori ordine dopo la riconnessione automatica (Bassa)

- **Evidenza.** v0.1.0, `drop-reconnect`: 10 frame rifiutati come duplicati e una correzione di
  9–19 px; un probe sul server mostrava il frame 402 accettato prima dei 391–400 bufferizzati
  dall'SDK.
- **Modifica.** Durante la riconnessione il client non produce input (stessa logica della guardia).
- **Prima/dopo.** dup 10 → 0, correzioni 1 → 0.

### N8 — Ack azzerato in `onReconnect` (Bassa, difensivo)

Non riprodotto in pratica (lo stato completo inviato alla riconnessione non conteneva l'ack
vecchio), ma `ps.ack = 0` è ora impostato subito, così nessuno snapshot può portare l'ack del flusso
precedente a un client che riparte da 0. Coperto da `reload-reconnect` (0 ack obsoleti).

### N9 — Osservabilità (Media)

"interp lag" nell'overlay mostrava `serverTick − renderTick`, cioè sempre la costante configurata
(110 ms). Ora l'overlay mostra ritardo e millisecondi realmente bufferizzati, pending attuale/p95/max,
età dell'ultimo ack e snap. Il server registra a fine sessione i contatori di input (`player left`),
utili in produzione per riconoscere problemi di rete senza debug route.

### T1 — Il proxy di test riordinava i frame (Media, strumenti)

- **Evidenza.** Con il proxy v0.1.0 gli scenari con jitter mostravano 47–108 frame "duplicati", ack
  che tornavano indietro (7–9 snapshot scartati come obsoleti) e colpi predetti diversi da quelli
  eseguiti (26 contro 23); dopo uno stallo, migliaia di frame riordinati.
- **Causa.** Un `setTimeout` per frame: timer con la stessa scadenza ma durate diverse non scattano
  in ordine di registrazione. TCP non riordina mai.
- **Modifica.** Una coda FIFO per direzione con un solo timer, RNG con seed.
- **Conseguenza.** I risultati "sotto latenza" di v0.1.0 erano parzialmente falsati; tutte le misure
  di questo audit usano il proxy corretto.

### S1 — TLS PostgreSQL non verificato (Alta)

- **Evidenza.** Con le opzioni v0.1.0 (`{ rejectUnauthorized: false }`) il client si connette a un
  server con CA non fidata e hostname non corrispondente (`pg_stat_ssl.ssl = true`): un
  man-in-the-middle sulla rete del database non verrebbe rilevato.
- **File.** `apps/server/src/persistence/pgSsl.ts` (nuovo), `config.ts`, `persistence/index.ts`,
  `pgRepository.ts`, `migrate-cli.ts`, `.env.example`, `render.yaml`, `docker-compose.yml`.
- **Modifica.** `DATABASE_SSL = disable | verify-full | verify-ca`, `DATABASE_SSL_CA` (PEM, anche
  su una riga con `\n`). Nessuna modalità "cifra senza verificare". `true`/`false` restano accettati.
  Render usa l'URL interno sulla rete privata (TLS non offerto, documentato); Scaleway richiede
  `verify-full` con il certificato dell'istanza.
- **Test.** `pgTls.test.ts` contro un PostgreSQL solo-TLS reale: CA giusta → connesso in TLS 1.3;
  nessuna CA, CA sbagliata, hostname non coperto, TLS disabilitato → rifiutato; `verify-ca` senza
  hostname → connesso; avvio completo con migrazioni via TLS. Lo stesso verificato dentro il
  container (CA sbagliata → uscita 1).

### S2 — `sslmode` nell'URL (Media)

`pg` applica i parametri della connection string sopra l'oggetto di configurazione: un
`?sslmode=no-verify` in `DATABASE_URL` annullava qualsiasi verifica. Ora i parametri TLS vengono
rimossi dall'URL con un warning. Test: "cannot be downgraded by sslmode=no-verify".

### S3 — `X-Forwarded-For` falsificabile (Alta)

- **Evidenza.** Server v0.1.0: 14 creazioni di profilo su 14 accettate con indirizzi falsificati
  (limite 10/min); senza falsificazione l'11ª riceve 429.
- **Modifica.** `TRUST_PROXY` (default 0 = indirizzo del socket; 1 su Render) e calcolo dell'IP
  dall'entry aggiunta dal proxy fidato (`security/clientIp.ts`), usato da API e matchmaking.
- **Test.** Unitari su `clientIp`; integrazione: 12 richieste con XFF falsi → 429. Verificato anche
  dietro un proxy TLS reale con `TRUST_PROXY=1` e XFF falsi: raggiunti i 10 profili/min per
  l'indirizzo reale, le richieste successive ricevono 429.

### S4 — Stanze create senza autenticazione (Alta)

- **Evidenza.** `POST /matchmake/create/arena` con un token inventato creava una stanza vera
  (timer 20 Hz, codice) che restava viva ~15 s. Due raffiche da 1000 richieste (1,2 s ciascuna)
  → 2000 stanze vive contemporaneamente, intervallo di tick massimo 877 ms invece di 50 (event loop
  saturato), +55 MB di memoria residente.
- **Causa.** `onAuth` era a livello di istanza: Colyseus crea la stanza prima di chiamarlo.
- **Modifica.** `onAuth` statico: il token è verificato durante la richiesta di matchmaking, prima di
  creare o riservare qualsiasi cosa. Il controllo "stessa identità due volte" è passato in `onJoin`.
- **Test.** "creates no room for a forged or missing identity token"; "refuses the same identity
  twice in one room". Dentro il container: 401, nessuna stanza.

### S5 — Matchmaking senza rate limit (Media)

Le route `/matchmake/*` sono gestite da Colyseus prima di Express. Ora un wrapper sul listener HTTP
applica 20 richieste di burst + 30/min per indirizzo (risposta 429 con CORS corretto). Test:
"rate-limits matchmaking requests per address".

### S6 — Token nei log (Media)

Colyseus allega le opzioni di join agli errori di autenticazione; la redazione di pino copriva solo
un livello. Ora token di identità e di riconnessione sono redatti fino a tre livelli di annidamento.
Verificato sull'output completo della suite: nessun token in chiaro.

### S7 — Limiter con memoria illimitata (Bassa)

Con molti indirizzi distinti recenti la mappa cresceva senza limite. Ora oltre 10.000 chiavi vengono
eliminate le più vecchie. Test: 25.000 chiavi → ≤ 10.001.

### S8 — `docker-compose.yml` (Bassa)

Conteneva `TOKEN_SECRET` in chiaro con `NODE_ENV=production` e pubblicava PostgreSQL su tutte le
interfacce. Ora il segreto è obbligatorio dall'ambiente (`docker compose config` fallisce senza) e
le porte sono legate a `127.0.0.1`.

### Altri controlli di sicurezza eseguiti (nessun difetto)

Campi riservati al proprietario (ack, munizioni, timer) assenti nello stato degli altri client;
stanze private non raggiungibili via `join`/`joinOrCreate`; token di riconnessione falsi rifiutati;
sequenza al massimo consentito accettata ma limitata al mittente, sequenza fuori range → disconnesso;
`viewTick` futuro limitato al tick corrente; tipi di messaggio sconosciuti e batch > 6 frame →
disconnessione del solo mittente; token manomessi, scaduti, di altro segreto o malformati rifiutati;
configurazione di produzione rifiuta segreti deboli, DB mancante e debug route.

### D1 — Errore di avvio del DB (Bassa)

Credenziali errate o verifica TLS fallita producevano uno stack non strutturato. Ora una riga
`fatal` JSON ("database unavailable at boot") e uscita 1; verificato nel container.

### D2 — Dimensione dell'immagine (Info, aperto)

`node_modules` di runtime 91 MB, di cui ~35 MB sono `typescript` e `@types/*` installati come peer
dependency. Non corretto: non è un rischio e la potatura va provata insieme alla build ufficiale.

## 4. Prestazioni (P1)

### Cosa è stato misurato

Benchmark `bench.html`: partita simulata reale (8 giocatori = 1 scriptato + 7 bot che si muovono,
mirano, sparano, muoiono e rinascono), 12 s di misura dopo 4 s di riscaldamento, Chrome con
**SwiftShader** su 2 vCPU. Questi numeri misurano il costo CPU del gioco e il rasterizzatore
software della VM; **non dicono nulla su una GPU reale**.

| Qualità | Giocatori | FPS medi | frame p50/p95/p99 (ms) | update p95 (ms) | invio render p95 (ms) | heap max (MB) |
|---|---|---|---|---|---|---|
| High | 1 | 12,2 | 65,1 / 128,9 / 176,2 | 0,7 | 4,1 | 38,5 |
| High | 2 | 12,0 | 67,0 / 132,7 / 187,8 | 0,5 | 3,4 | 42,3 |
| High | 8 | 11,6 | 68,6 / 147,9 / 255,2 | 2,5 | 6,0 | 42,3 |
| Low | 1 | 13,2 | 61,8 / 115,3 / 127,7 | 0,4 | 1,7 | 42,5 |
| Low | 2 | 12,8 | 62,3 / 166,3 / 192,3 | 0,4 | 1,3 | 48,8 |
| Low | 8 | 11,9 | 65,6 / 123,9 / 180,8 | 0,6 | 7,1 | 49,5 |

(1366×768, `data/bench-swiftshader-1366x768.json`)

- **Il collo di bottiglia qui è il riempimento dei pixel, non il codice.** Con 8 giocatori:
  640×360 → 37,5 FPS, 1366×768 → 11,6, 1920×1080 → 4,9: gli FPS scalano con il numero di pixel.
  La logica di gioco (update) costa ≤ 3,4 ms al p95 anche nel caso peggiore.
- **Scomposizione a 1366×768:** solo camera e HUD 26 ms per frame; + mappa (un quad a schermo
  intero) +24 ms; + luci additive +16 ms; + giocatori ed effetti +5 ms. Su una GPU reale ciascuno di
  questi passaggi costa una frazione di millisecondo; su un rasterizzatore software a 2 core costa
  decine. Un canvas WebGL vuoto nella stessa VM gira a 60 FPS a tutte le risoluzioni.
- **High contro Low:** differenza del 5–10 % in questo ambiente (la vignetta pesa poco, le luci di
  più). Il parametro che sposterebbe davvero gli FPS su hardware debole è la risoluzione di render,
  non gli effetti (proposto in roadmap, non implementato: modificherebbe la resa grafica).
- **Memoria:** heap dopo GC stabile a ~36 MB su 90 s con 8 giocatori; 10 cicli di ingresso/uscita
  dalla partita +2,3 MB e oggetti di scena tornati a 51: nessuna perdita. Texture ~17 MB (la mappa
  2560×1664, sotto il limite di 4096 px delle GPU mobili).
- **Rete lato client:** il costo della riconciliazione è trascurabile (0,07 ms con 20–60 input in
  sospeso).
- Lo screenshot con 13 FPS corrisponde esattamente a questo ambiente (12–13 FPS con SwiftShader a
  1366×768).
- **Pianificazione del benchmark:** nel viewer degli artifact (e in Chrome sotto carico di rendering)
  i timer possono restare fermi per più di 2 s mentre i frame continuano (misurato qui: 2,3 s). La
  prima versione del benchmark avanzava la simulazione solo con `setInterval`, quindi la guardia di
  stallo scattava a intermittenza ("0 ms" / "Connection interrupted"). Ora la simulazione locale
  avanza a 20 Hz fissi pilotata anche dai frame, e il report registra quanti tick sono arrivati dal
  timer e quanti dai frame. Il gioco vero non dipende da timer nel percorso di rete (messaggi
  WebSocket), quindi il difetto riguardava solo il benchmark.

### Cosa manca

**Il target dei 60 FPS su hardware adeguato non è verificato.** Il benchmark è pronto e pubblicato
(artifact privato "Scrapline Benchmark") e gira anche da `/bench.html` sul client deployato. Va
eseguito su almeno: un portatile con grafica integrata di fascia media, un desktop con GPU dedicata,
un Mac. Criterio proposto: FPS medi ≥ 58 e frame p95 ≤ 20 ms con 8 giocatori in qualità High alla
risoluzione nativa del display.

## 5. Build e deployment

| Verifica | Risultato |
|---|---|
| `docker build` del Dockerfile reale | Riuscito con un'immagine base sostitutiva (stesso Node 22.23, corepack, utente `node`): tutti i registry sono bloccati qui (Docker Hub, ECR, GCR, GHCR → 403). Install con lockfile, build, `pnpm deploy --prod`, layout runtime corretti. |
| Avvio del container | `healthy` in ~6 s, processo come `node` (uid 1000), migrazioni applicate, `/health` 200, CORS solo per l'origine configurata, `/api/debug/*` 404 in produzione |
| SIGTERM | Con un giocatore connesso: avviso "Server update pending", attesa `SHUTDOWN_DRAIN_SEC`, client chiuso con 4001, uscita 0 in 5,1 s; senza giocatori uscita immediata |
| TLS verso PostgreSQL nel container | `verify-full` con CA giusta → connesso (anche con `sslmode=no-verify` nell'URL, ignorato); CA sbagliata → uscita 1 |
| WSS | Client SDK su `https://`/`wss://` dietro un proxy che termina TLS e aggiunge `X-Forwarded-For`, con `TRUST_PROXY=1`: join, stato, rate limit sull'indirizzo reale |
| `render.yaml`, `vercel.json`, `docker-compose.yml` | Sintassi valida; rewrite Vercel verificati (SPA su `/`, `/join/...`; `bench.html`, `assets/`, `favicon.svg` serviti come file); compose rifiuta l'avvio senza `TOKEN_SECRET` |
| Non verificato | Build con la base ufficiale; deploy reale; schema ufficiale del Blueprint Render (piani e campi verificati solo sulla documentazione) |

## 6. Rischi residui

1. **Prestazioni su GPU reale non misurate** (P1). Su GPU integrate vecchie a risoluzioni alte il
   gioco potrebbe non tenere 60 FPS; manca anche una scala di risoluzione come rimedio.
2. **Lag switch limitato:** un client modificato può accumulare fino a 0,75 s di input e
   rieseguirli a 2× (prima 0,25 s). La compensazione del lag resta limitata a 300 ms.
3. **Stalli lunghi con RTT alto:** a 250 ms di RTT uno stallo > 0,75 s scarta alcuni frame e produce
   una correzione sfumata (misurati 27 px). Durante lo stallo il giocatore resta fermo con
   "Connection interrupted".
4. **Token al portatore:** token di identità (1 anno, senza revoca) e di riconnessione stanno nello
   storage del browser; un XSS li esporrebbe. Mitigato da CSP restrittiva e da React (nessun HTML
   non sanificato), non eliminato.
5. **Istanza singola:** rate limit, stanze e presenza sono in memoria; più istanze richiedono Redis.
6. **CSP `connect-src https: wss:`** è ampia per permettere un dominio API qualsiasi: restringerla al
   dominio reale al primo deploy.
7. **Firefox e Safari non testati;** reti reali tra dispositivi diversi non testate.
8. **Immagine base ufficiale non costruita qui** e immagine runtime più grande del necessario (D2).

## 7. Condizioni per la pubblicazione

- [ ] Eseguire `bench.html` sull'hardware di riferimento e confermare il criterio dei 60 FPS (§4);
      se non raggiunto, decidere su scala di risoluzione o default Low prima del lancio.
- [ ] Build dell'immagine con `node:22-bookworm-slim` in CI o in locale (`docker build -f
      docker/server.Dockerfile .`) e avvio con `docker compose` (TOKEN_SECRET dall'ambiente).
- [ ] Autorizzare la creazione delle risorse Render (servizio + database) e Vercel, rivedendo i piani.
- [ ] Impostare `ALLOWED_ORIGINS`, `VITE_SERVER_URL`, `TRUST_PROXY=1`; su Scaleway `DATABASE_SSL=verify-full`
      con la CA dell'istanza.
- [ ] Restringere `connect-src` della CSP al dominio API reale.
- [ ] Checklist post-deploy di docs/DEPLOYMENT.md con due dispositivi su reti diverse, incluso un
      reload durante una partita e un cambio di rete (Wi-Fi → hotspot).
- [ ] Verificare nei log del primo giorno le righe `player left`: `overflow`, `trimmed` e
      `duplicate` devono restare a 0 o quasi.

## 8. Come riprodurre

```bash
# Matrice netcode (dopo) e riproduzione legacy (prima)
ENABLE_DEBUG_ROUTES=true PORT=2600 pnpm --filter @scrapline/server exec tsx src/index.ts &
node tests/tools/netem-proxy.mjs --listen 2610 --target http://localhost:2600 --latency 0 &
pnpm --filter @scrapline/server netaudit -- --server http://localhost:2600 --proxy http://localhost:2610
git apply docs/audit/data/legacy-tick-repro.patch   # su una copia; poi ripetere con --only rtt0

# Test completi, inclusi PostgreSQL e TLS
sudo tests/tools/pg-tls-setup.sh /tmp/pgtls
TEST_DATABASE_URL=... TEST_PG_TLS_URL=... TEST_PG_TLS_CA_FILE=... TEST_PG_TLS_WRONG_CA_FILE=... pnpm test

# E2E con due browser a 0, 120 e 250 ms di RTT
pnpm test:e2e
E2E_LATENCY_MS=120 E2E_JITTER_MS=30 E2E_SPIKE_RATE=0.01 pnpm test:e2e
E2E_LATENCY_MS=250 E2E_JITTER_MS=50 pnpm test:e2e

# Benchmark client
pnpm --filter @scrapline/web build && pnpm --filter @scrapline/web preview &
node tests/perf/run-bench.mjs --url http://localhost:4173/bench.html --out bench.json [--gpu]
```

Fonti per la configurazione TLS dei provider:
[Render, connection strings](https://render.com/tutorials/postgres-on-render/connection-strings),
[Scaleway, verify CA for PostgreSQL](https://www.scaleway.com/en/docs/managed-databases-for-postgresql-and-mysql/api-cli/verify-ca-postgresql/).
