# Simulacro de Continuidad MR · Meta Quest + Copiloto de Continuidad

Kit para ejercicios de continuidad de negocio (ISO 22301), en la misma sala o cada participante desde su sitio,
con tres piezas que funcionan
**sin servidor, sin base de datos y sin conexión** una vez cargadas:

| Pieza | Dónde | Qué hace |
|---|---|---|
| **Simulador MR** (`/`) | Navegador de Meta Quest (WebXR, passthrough) | **Centro de mando** alrededor de cada participante: rondas, injects, decisiones A–D por rol, **Panel de Crisis virtual** (el copiloto dentro de las gafas), barra de mando con línea de tiempo, voz narradora, audio 3D, registro de evidencias JSON/CSV |
| **Copiloto de Continuidad web** (`/copiloto/`) | Opcional: portátil o TV | La misma lógica en versión web completa (con historial, ficha imprimible y catálogo desde Google Sheets). Modo ejercicio con reloj simulado |
| **Debrief** (`/debrief/`) | PC del facilitador | Consolida los registros de R1/R2/R3: valoración por capacidad frente a la hoja de respuestas, hallazgos y acciones de mejora editables, actuaciones en el Panel de Crisis, discrepancias, tiempos y cronología; exporta JSON/CSV/PDF |

Todo el contenido es **ficticio y anónimo** (organización «la Compañía», buzones de rol en `compania.example`).

## Puesta en marcha

WebXR exige HTTPS. Con GitHub Pages: *Settings → Pages → Deploy from a branch*, rama de trabajo, carpeta `/ (root)`.
Después:

- Gafas: `https://<usuario>.github.io/<repo>/`
- TV: `https://<usuario>.github.io/<repo>/copiloto/` (añade `?ejercicio` para abrir la barra de ejercicio;
  `?vista=lectura` muestra solo la pestaña Impacto, sin controles).
- Facilitador: `https://<usuario>.github.io/<repo>/debrief/`

Tras la primera visita todo queda en caché (service worker) y funciona sin red; si la red de la sala tarda más de
3 s en responder, se sirve lo guardado y se actualiza en segundo plano. En local basta con
`python3 -m http.server 8080` (las gafas necesitan HTTPS o `adb reverse tcp:8080 tcp:8080`).

## Centro de mando (sin pared ni calibración)

Al entrar, cada participante mira al frente y los paneles se colocan **en un arco a su alrededor**, no en las paredes.
Funciona igual en una sala compartida, en casa o en un despacho, y no hay que calibrar nada:

| Zona | Qué hay |
|---|---|
| Frente | Lectura principal: injects, decisiones y fin de ronda. Encima, la **barra de mando** |
| Izquierda | **Panel de Crisis**; las actuaciones que pide la ronda aparecen entre el panel y el frente |
| Derecha | Tarjetas de resumen del rol (botón *Resumen*) y avisos que llegan «de fuera» (ancla `DOOR`) |
| Abajo | Documentos «sobre la mesa» (ancla `TABLE`), algo inclinados |

- **Barra de mando:** rol, ronda, reloj del ejercicio, quién está conectado, botones (*Menú*, *Resumen*, *Voz*,
  *Recentrar*) y la **línea de tiempo** de la ronda en curso: avisos vistos, actuación en el panel y decisiones con la
  letra registrada.
- **Recentrar:** si el participante se gira o cambia de silla, mira al frente y pulsa *Recentrar* (en la barra, en la
  pantalla de inicio o en el menú).
- Los paneles entran con un fundido breve y el mando vibra al pasar por un botón y al pulsarlo.
- **Modo sala** (casilla del briefing): vuelve al comportamiento anterior, con el Panel de Crisis anclado a una pared
  calibrada (pared, puerta, mesa y zona de lectura). Útil solo si todos comparten sala y queréis el panel en la pared.

Las anclas del pack (`TV`, `DOOR`, `TABLE`, `FRONT`) siguen siendo válidas: en el centro de mando se traducen a
las zonas del arco (`js/layout.js`).

### Panel de Crisis virtual

Pantalla grande con las pestañas del copiloto (Activación, Impacto, Nivel, Servicios RTO, Comité, Comunicaciones)
que se opera con el rayo del mando o con la mano:

- Seleccionar escenarios y categoría (C1–C3), *Analizar/Recalcular impacto*, ajustar la hora real de inicio.
- Reloj de seguimiento y pérdida acumulada; pausar, reanudar o cerrar el seguimiento.
- Nivel con el desglose de puntos; servicios por RTO paginados; comité (ficha y convocatoria); comunicaciones
  con cuenta atrás RGPD y fichas que se marcan como notificadas.
- Cuando una ronda pide una actuación, el panel salta solo a la pestaña indicada y la instrucción aparece a su lado.
- Cada actuación queda en el registro (`panel_analyzed`, `panel_onset_set`, `panel_status`, `panel_comm_marked`,
  `panel_committee_convened`, `panel_disaster`) y aparece en la cronología del debrief.
- Al empezar cada ronda el panel se ajusta al **estado de referencia** del pack, para que todos los visores
  (también sin red entre ellos) vean lo mismo; dentro de la ronda cada uno puede operarlo.

### Inmersión

- **Voz narradora** (`SpeechSynthesis`, sin red): lee el inicio de ronda, alertas, llamadas, documentos, actuaciones
  y preguntas. Botón *Voz* en la barra de mando y casilla en el briefing. Si el visor no tiene voz en español, queda en silencio.
- **Audio posicional** (`THREE.PositionalAudio`): cada aviso suena desde el panel donde aparece, con atenuación por
  distancia.
- **Oclusión por profundidad** (WebXR `depth-sensing`, Quest 3/3S): las personas y los muebles reales tapan los paneles.
  Casilla en el briefing; si el visor no la ofrece, se entra sin ella. En modo sala, los paneles de pared se separan
  15 cm para que la pared no los corte.
- **Texto estable a distancia:** texturas con mipmaps trilineales (`LinearMipmapLinearFilter`) y la anisotropía
  máxima del visor.
- *Estimación de luz:* no se usa. Los paneles son interfaz sin iluminación y el navegador de Quest no expone
  `light-estimation`; solo aportaría algo con objetos 3D iluminados (p. ej. un teléfono modelado).

## Sincronización en directo entre visores

Con la casilla *Sincronizar en directo* (activada por defecto en el briefing), los visores con el **mismo pack y
código de sesión** forman una sala:

- **Panel de Crisis compartido:** lo que cualquiera opera (escenarios, categorías, analizar, hora de inicio,
  pausar/cerrar, comunicaciones notificadas, convocatoria) aparece al instante en los demás, con aviso
  («R2 ha analizado el impacto») y voz. La pestaña abierta es de cada uno. Un visor que llega tarde recibe el estado
  actual y el estado de referencia de la ronda no pisa lo ya operado. La versión del estado es un **reloj lógico**,
  no la hora de cada gafa (un visor con el reloj desajustado no se impone), y los campos se fusionan: escenarios e
  incidente siguen al cambio más reciente, y las comunicaciones notificadas y la convocatoria se acumulan, así dos
  actuaciones casi simultáneas no se pisan (`js/shared-state.js`). Los mensajes con forma inesperada se descartan.
- **Decisiones:** cuando el rol activo confirma, su elección aparece resaltada en los demás visores
  («R2 ha elegido C · registrada automáticamente»), se registra sola como observada con `sync_from` y el visor avanza
  al siguiente paso a los pocos segundos (o al pulsar *Continuar*). Si un visor llega a la decisión cuando ya estaba
  tomada, la ve y avanza igual. Solo se acepta la respuesta del visor cuyo rol decide y con una letra A–D; si el rol
  activo corrige su decisión, la corrección llega también. Sin conexión con ese visor, se registra a mano la letra
  que anuncie (en remoto, por teléfono); si después llega una letra distinta, se conserva la registrada a mano y el
  debrief marca la discrepancia.
- **Presencia:** la barra de mando muestra quién está conectado (🔗 R1 · R3) y el menú ofrece *Ir a donde está R2* si alguien
  va por otro paso.
- **Sin red no pasa nada:** cada visor sigue funcionando solo y reintenta la conexión cada pocos segundos.

Cómo funciona: WebRTC con [PeerJS](https://peerjs.com) (incluido en `vendor/`). El primer visor ocupa el identificador
de anfitrión de la sala y reenvía los mensajes; si se cae, otro lo sustituye automáticamente. Hace falta Internet para
el emparejamiento (servidor público de PeerJS); los datos van directos entre visores o, si la wifi los aísla, por
los servidores TURN de PeerJS. Solo viajan datos del ejercicio (ficticios). El código de sesión propuesto lleva la
fecha y tres caracteres al azar (p. ej. `20261012-K7F`) para no coincidir con otra sala: el primer visor lo genera y
los demás lo copian. No hay canal de voz: si los participantes no comparten sala, que hablen por teléfono o por
videollamada.

Para probar sin gafas: abre tres pestañas con `?sync=local` (sincroniza pestañas del mismo navegador).

## Cómo encaja en un simulacro

1. **Visores (Quest):** mismo código de sesión, un rol por visor, mirar al frente y COMENZAR. En la misma sala o cada
   uno desde su sitio (con teléfono o videollamada para hablar). El Panel de Crisis virtual sustituye a la TV.
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
- **Huella del catálogo:** la barra de ejercicio de la TV y la pantalla de inicio de las gafas muestran una huella
  corta del catálogo con el que calculan. Las gafas usan siempre el catálogo incluido; si la TV importó otra hoja,
  las huellas no coinciden. Cada registro guarda la suya y el debrief avisa si los visores usaron catálogos distintos.

## Debrief

1. Cada visor exporta su JSON al terminar; el facilitador los arrastra a `/debrief/`.
2. El informe muestra, por **capacidad del SGCN** (detección y escalado, autoridad, recuperación, comunicaciones,
   obligaciones, información, decisión con incertidumbre, terceros, retorno), cuántas decisiones coinciden con la
   referencia y cuántas se desvían (y con qué gravedad). No hay nota global: el diseño pide leerlo por capacidad.
3. **Hallazgos y acciones de mejora:** se proponen a partir de las desviaciones y discrepancias; el facilitador los
   edita, descarta o añade (responsable y plazo). Se guardan en el navegador y salen en el JSON consolidado,
   en un CSV de acciones de mejora y en el informe impreso/PDF.
4. También: actuaciones reales en el Panel de Crisis por ronda, decisiones con la respuesta de referencia y su
   justificación, tiempos por rol y cronología.
5. **Integridad:** cada visor encadena sus eventos con SHA-256 (cada evento lleva el hash del anterior más el suyo).
   Al exportar, las gafas muestran la **huella del registro** (p. ej. `810c df17 c5fc`): anotadla o fotografiadla.
   El debrief recalcula la cadena, comprueba que las decisiones cuadran con sus eventos y muestra la huella de cada
   registro; si alguien edita el JSON (una letra, un evento), la cadena aparece rota. Si alguien rehiciera la cadena
   entera, la huella dejaría de coincidir con la anotada. Los registros de versiones anteriores salen como
   «sin cadena».
6. Los CSV neutralizan el texto que empieza por `=`, `+`, `-` o `@`, para que Excel no lo ejecute como fórmula.

La hoja de respuestas vive en `packs/<pack>/debrief.json` (`preferred_response`, `capability`,
`severity_if_missed`, `rationale`). La de TRAMONTANA es una **propuesta** (`"status": "propuesta"`) pendiente de
validar; el debrief lo advierte. Nunca se muestra a los participantes durante el ejercicio.

## Formato de pack (`crisis.exercise/1.0`)

- `rounds[].events[]`: `type` ∈ PHONE, DOCUMENT, ALERT, MESSAGE, INFO_CARD; `anchor` ∈ TV, DOOR, TABLE, FRONT.
- `rounds[].panel_actions[]`: `tab`, `text`, `when` = `before` | `after` (respecto a las decisiones).
- `rounds[].decisions[]`: `id`, `role`, `question`, cuatro `answers` A–D; `assessment` opcional
  (`preferred_response`, `capability`, `severity_if_missed`) o en `debrief.json → assessments`.
- `rounds[].copilot`: estado del copiloto al empezar la ronda —
  `{"clock": "D0 07:33", "declared": "D0 07:08", "onset": "D0 06:02", "scenarios": {"E3": 1, "E6": 2}}`
  (día relativo del ejercicio + hora; escenario → categoría 1–3).

Al cargar un pack se valida, además de la estructura: el formato de las horas y las categorías del bloque `copilot`,
que la pestaña de cada actuación exista en el Panel de Crisis, y en `debrief.json` las letras de referencia, la
gravedad (`high`/`medium`/`low`) y que cada capacidad tenga etiqueta. Un pack con errores no se puede iniciar.

## Estructura

```
index.html, js/, css/           Simulador MR (WebXR)
js/crisis-panel.js              Panel de Crisis virtual (copiloto dentro de las gafas)
js/layout.js                    Zonas del centro de mando (arco alrededor del participante)
js/command-bar.js               Barra de mando y línea de tiempo de la ronda
js/copilot-view.js              Tarjetas de resumen por rol
js/voice.js                     Voz narradora (SpeechSynthesis)
js/sync.js                      Sincronización entre visores (PeerJS/WebRTC o pestañas locales)
js/shared-state.js              Versión y fusión del estado compartido del Panel de Crisis
js/integrity.js                 SHA-256 y cadena de integridad del registro (visor y debrief)
js/csv.js                       Celdas CSV seguras (visor y debrief)
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
tests/                          Pruebas del motor, del consolidador, de los packs y del simulador (npm test)
```

## Comprobaciones

```
npm test                              # motor, consolidador, packs, centro de mando y sincronización
node tools/comprobar-anonimato.mjs    # sin referencias a la organización real ni correos reales
```

La integración continua (`.github/workflows/comprobaciones.yml`) ejecuta ambas en cada push.

## Pendiente

- Lecturas del Panel (R2) con teclado en MR y consultas documentales cronometradas.
- Multimedia en injects (audio de llamadas, recortes de prensa ficticios) y consecuencias condicionales.
- Validar con el equipo la hoja de respuestas de TRAMONTANA (`debrief.json`, hoy en estado «propuesta»).
- Sincronización opcional TV ↔ gafas por red local.
- Consola del facilitador para lanzar rondas e injects a todos a la vez (ejercicios en remoto).
- Maqueta esquemática de sedes y dependencias en el centro de mando, generada desde el pack.
- Texto vectorial (MSDF) en los paneles para ganar nitidez y no redibujar texturas completas.
