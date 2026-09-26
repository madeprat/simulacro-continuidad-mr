# Simulacro de Continuidad MR · Meta Quest + Copiloto de Continuidad

Kit para ejercicios presenciales de continuidad de negocio (ISO 22301) con tres piezas que funcionan
**sin servidor, sin base de datos y sin conexión** una vez cargadas:

| Pieza | Dónde | Qué hace |
|---|---|---|
| **Simulador MR** (`/`) | Navegador de Meta Quest (WebXR, passthrough) | Rondas, injects en la sala, decisiones A–D por rol, **Panel de Crisis virtual** en la pared (el copiloto dentro de las gafas), voz narradora, audio 3D, registro de evidencias JSON/CSV |
| **Copiloto de Continuidad web** (`/copiloto/`) | Opcional: portátil o TV | La misma lógica en versión web completa (con historial, ficha imprimible y catálogo desde Google Sheets). Modo ejercicio con reloj simulado |
| **Debrief** (`/debrief/`) | PC del facilitador | Consolida los registros de R1/R2/R3, detecta discrepancias, tiempos por rol y cronología; exporta JSON/CSV/PDF |

Todo el contenido es **ficticio y anónimo** (organización «la Compañía», buzones de rol en `compania.example`).

## Puesta en marcha

WebXR exige HTTPS. Con GitHub Pages: *Settings → Pages → Deploy from a branch*, rama de trabajo, carpeta `/ (root)`.
Después:

- Gafas: `https://<usuario>.github.io/<repo>/`
- TV: `https://<usuario>.github.io/<repo>/copiloto/` (añade `?ejercicio` para abrir la barra de ejercicio;
  `?vista=lectura` muestra solo la pestaña Impacto, sin controles).
- Facilitador: `https://<usuario>.github.io/<repo>/debrief/`

Tras la primera visita todo queda en caché (service worker) y funciona sin red. En local basta con
`python3 -m http.server 8080` (las gafas necesitan HTTPS o `adb reverse tcp:8080 tcp:8080`).

## Panel de Crisis virtual (sin TV)

La TV ya no es necesaria. Al calibrar, el primer punto es la **pared del Panel de Crisis**: allí aparece una
pantalla grande con las pestañas del copiloto (Activación, Impacto, Nivel, Servicios RTO, Comité, Comunicaciones)
que se opera con el rayo del mando o con la mano:

- Seleccionar escenarios y categoría (C1–C3), *Analizar/Recalcular impacto*, ajustar la hora real de inicio.
- Reloj de seguimiento y pérdida acumulada; pausar, reanudar o cerrar el seguimiento.
- Nivel con el desglose de puntos; servicios por RTO paginados; comité (ficha y convocatoria); comunicaciones
  con cuenta atrás RGPD y fichas que se marcan como notificadas.
- Cuando una ronda pide una actuación, el panel salta solo a la pestaña indicada y la instrucción aparece a su derecha.
- Cada actuación queda en el registro (`panel_analyzed`, `panel_onset_set`, `panel_status`, `panel_comm_marked`,
  `panel_committee_convened`, `panel_disaster`) y aparece en la cronología del debrief.
- Al empezar cada ronda el panel se ajusta al **estado de referencia** del pack, para que los tres visores
  (sin red entre ellos) vean lo mismo; dentro de la ronda cada uno puede operarlo.
- El botón *Resumen* del HUD muestra, a la izquierda del panel, las tarjetas del rol (R1 nivel + reloj,
  R2 nivel + servicios, R3 comunicaciones + reloj).

### Inmersión

- **Voz narradora** (`SpeechSynthesis`, sin red): lee el inicio de ronda, alertas, llamadas, documentos, actuaciones
  y preguntas. Botón *Voz* en el HUD y casilla en el briefing. Si el visor no tiene voz en español, queda en silencio.
- **Audio posicional** (`THREE.PositionalAudio`): el teléfono suena desde la mesa y cada aviso desde su ancla
  (puerta, panel…), con atenuación por distancia.
- **Oclusión por profundidad** (WebXR `depth-sensing`, Quest 3/3S): las personas y los muebles reales tapan los paneles.
  Casilla en el briefing; si el visor no la ofrece, se entra sin ella. Los paneles de pared se separan 15 cm para
  que la pared no los corte.
- **Texto estable a distancia:** texturas con mipmaps trilineales (`LinearMipmapLinearFilter`) y la anisotropía
  máxima del visor.
- *Estimación de luz:* no se usa. Los paneles son interfaz sin iluminación y el navegador de Quest no expone
  `light-estimation`; solo aportaría algo con objetos 3D iluminados (p. ej. un teléfono modelado).

## Cómo encaja en un simulacro

1. **Visores (Quest):** mismo código de sesión, un rol por visor, calibración de pared del panel/puerta/mesa/frente
   y COMENZAR. El Panel de Crisis virtual sustituye a la TV.
2. **Opcional (facilitador):** el copiloto web (`/copiloto/?ejercicio`, *Aplicar ronda*) en un portátil o TV sirve
   para seguir el ejercicio desde fuera o proyectarlo; usa el mismo motor y el mismo estado de ronda, pero no se
   sincroniza en directo con las gafas.
3. **Cierre:** cada visor exporta su JSON; el facilitador los arrastra a `/debrief/`.

## Copiloto de Continuidad

Es una versión estática y anónima del panel original, con la misma lógica:

- **Afectación:** un servicio entra si su exposición al escenario (25/50/75/100 %) alcanza el umbral del escenario (75 %).
- **Nivel:** base del escenario + (categoría − 1), más 0,5 por cada criterio (≥3/≥8/≥15 servicios, RTO ≤4 h/≤2 h,
  pérdida ≥1.500/≥5.000 €/h, ≥1/≥4 críticos, escenario hostil/proveedor/personas). N2 ≥ 2,5 · N3 ≥ 4.
  Escalada automática a N3 por categoría 3, MTPD superado o pérdida acumulada sobre el umbral.
- **Reloj y desastre:** pérdida acumulada = Σ €/h × tiempo desde el inicio real; condición de desastre al superar
  el umbral o con servicios críticos fuera de MTPD, lo que desbloquea la ficha de activación del comité.
- **Comunicaciones:** seguridad / cliente público / datos personales, con cuenta atrás RGPD de 72 h.

Diferencias deliberadas respecto al original: sin enlaces a sistemas internos; las categorías de los escenarios
se guardan con la activación (antes se perdían al recargar); las pestañas Nivel/Servicios/Comité se habilitan
tras el primer análisis sin recargar; el impacto «Crítico» se reconoce con o sin tilde; reloj simulado para ejercicios.

**Persistencia:** no hay base de datos. El estado del incidente y el historial viven en el navegador de la TV
(`localStorage`) y el historial se exporta a CSV desde su pestaña.

### Catálogo: JSON incluido o Google Sheets

- `copiloto/data/*.json` se genera con `python3 tools/generar_catalogo.py` (40 servicios, 7 escenarios,
  8 estrategias). Está calibrado con TRAMONTANA: E3 + E6 → 26 servicios, RTO mínimo 2 h, 8.809,82 €/h.
- Para editarlo sin tocar código: importa `copiloto/data/plantilla/*.csv` en una hoja de Google, publica cada
  pestaña como CSV (*Archivo → Compartir → Publicar en la web*) y pega las tres URL en la barra de ejercicio →
  *Importar*. Se guarda en el navegador y sigue funcionando offline. Basta con permiso de lectura
  (la publicación es pública para quien tenga el enlace: usa solo datos ficticios).

## Formato de pack (`crisis.exercise/1.0`)

- `rounds[].events[]`: `type` ∈ PHONE, DOCUMENT, ALERT, MESSAGE, INFO_CARD; `anchor` ∈ TV, DOOR, TABLE, FRONT.
- `rounds[].panel_actions[]`: `tab`, `text`, `when` = `before` | `after` (respecto a las decisiones).
- `rounds[].decisions[]`: `id`, `role`, `question`, cuatro `answers` A–D; `assessment` opcional
  (`preferred_response`, `capability`, `severity_if_missed`) o en `debrief.json → assessments`.
- `rounds[].copilot`: estado del copiloto al empezar la ronda —
  `{"clock": "D0 07:33", "declared": "D0 07:08", "onset": "D0 06:02", "scenarios": {"E3": 1, "E6": 2}}`
  (día relativo del ejercicio + hora; escenario → categoría 1–3).

## Estructura

```
index.html, js/, css/           Simulador MR (WebXR)
js/crisis-panel.js              Panel de Crisis virtual (copiloto dentro de las gafas)
js/copilot-view.js              Tarjetas de resumen por rol
js/voice.js                     Voz narradora (SpeechSynthesis)
copiloto/                       Copiloto de Continuidad para la TV
  js/core.js                    Motor de cálculo común (TV y gafas)
  js/copiloto.js                Interfaz portada del panel original
  js/backend.js, clock.js       Estado local del incidente y reloj real/simulado
  js/data.js, ejercicio.js      Catálogo (JSON/Sheets) y barra de ejercicio
  data/, data/plantilla/        Catálogo ficticio y plantillas CSV
  docs/                         Documentos de ejemplo (plan, estrategias, directorio)
debrief/                        Consolidador de registros
packs/tramontana/               Pack de ejemplo
tools/generar_catalogo.py       Genera el catálogo ficticio
tools/comprobar-anonimato.mjs   Control de anonimato (también en CI)
tests/                          Pruebas del motor y del consolidador (npm test)
```

## Comprobaciones

```
npm test                              # motor del copiloto y consolidador
node tools/comprobar-anonimato.mjs    # sin referencias a la organización real ni correos reales
```

La integración continua (`.github/workflows/comprobaciones.yml`) ejecuta ambas en cada push.

## Pendiente

- Lecturas del Panel (R2) con teclado en MR y consultas documentales cronometradas.
- Multimedia en injects (audio de llamadas, recortes de prensa ficticios) y consecuencias condicionales.
- Hoja de respuestas en `debrief.json` para la valoración de referencia.
- Sincronización opcional TV ↔ gafas por red local.
