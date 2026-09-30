# unamas — contexto para Claude Code

Nombre de la app: **unamas** (junto, en minúsculas). Slug y carpeta: `unamas`.

Lee este archivo completo antes de escribir código. Los detalles del algoritmo están en `docs/PROGRESSION.md` y los mockups aprobados en `design/flow.html` (ábrelo en un navegador; las pantallas 1, 4 y 6 son interactivas).

## 1. Qué es

Una app móvil para registrar el entrenamiento de fuerza **hablándole o escribiéndole como a una persona** ("press de hombro 24 kg, 4 de 9"). La app lo convierte en datos, lo compara con tu última vez y te sugiere la próxima meta con sobrecarga progresiva basada en evidencia.

Principios de producto, decididos con el dueño (Jason):
- **Una pantalla principal conversacional.** Nada de menús ni botones innecesarios, y nada de pantallas genéricas de app de gym.
- **Todo lo importante está siempre visible.** No hay gestos escondidos: si existe un gesto, la UI tiene que mostrar que existe.
- **El verde significa progreso.** Solo aparece para acciones principales y logros.
- **La IA entiende texto; el código decide números.** El algoritmo de progresión es determinista (ver §5).
- Idioma de la UI: **español**, tono cercano y breve. El código y los identificadores van en inglés.

## 2. Alcance del MVP

**Incluye:** elegir músculos → anotar ejercicios por texto, voz o foto → feedback contra la última vez → sugerencias desde el historial → pregunta cuando algo es ambiguo → terminar la sesión → resumen.

**Fuera del MVP (decidido):** mascota, cuentas de usuario y sincronización en la nube, volumen semanal por músculo, descargas programadas, pedir RIR/RPE en cada serie, Android pulido (se prioriza iOS, pero sin romper Android), modo claro.

## 3. Stack

| Capa | Elección | Notas verificadas (sep 2026) |
|---|---|---|
| App | **Expo + React Native + TypeScript** | Crear con `npx create-expo-app@latest`, que trae el SDK más reciente |
| Datos locales | **expo-sqlite** | API async: `openDatabaseAsync`, `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`; `SQLiteProvider` + `useSQLiteContext` con `onInit` para migraciones |
| Voz | **expo-speech-recognition** (jamsch) | Necesita **development build** (no funciona en Expo Go). `ExpoSpeechRecognitionModule.requestPermissionsAsync()`, `.start({ lang, interimResults: true })`, `useSpeechRecognitionEvent('result', …)` |
| Háptica | expo-haptics | |
| Foto | expo-image-picker | Para máquinas que el usuario no sabe nombrar |
| Backend | **Cloudflare Worker** (una función), sin base de datos | Solo hace de proxy a la API de Claude y guarda la clave como secreto |
| IA | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | $1/MTok de entrada, $5/MTok de salida, con visión. Usa **structured outputs**: `output_config.format = { type: "json_schema", schema }`, sin header beta (`output_format` está deprecado) |
| Tests | Jest (lo trae Expo) para el motor; Vitest en el worker | |

Costo estimado de IA: ~1.500 tokens de entrada + ~150 de salida por mensaje ≈ **$0.002**. Con ~15 mensajes por sesión ≈ **$0.03 por sesión**.

Antes de usar cualquier API, verifica en su documentación actual. Las notas de arriba se revisaron el 28 sep 2026.

Librerías extra: `zustand` (estado de la sesión activa), `zod` (validar el contrato con el worker, en ambos lados), `react-native-reanimated` + `react-native-worklets` (animaciones, vienen en Expo), `react-native-svg` (anillo del stop), `@react-native-community/netinfo` (cola sin conexión).

**Sin ORM:** son 3 tablas, así que basta con repositorios tipados sobre expo-sqlite. Drizzle con expo-sqlite hoy se instala en versión RC y pide configuración extra de Babel para las migraciones; no compensa en el MVP.

## 4. Arquitectura de la app

### 4.1 Capas (las dependencias van solo hacia abajo)

```
┌──────────────────────────────────────────────────────────────┐
│ UI   app/ (rutas) + src/ui/ (componentes, animaciones, tokens) │  React, Reanimated
├──────────────────────────────────────────────────────────────┤
│ Feature   src/features/session/                                 │  controlador de sesión (máquina de estados)
│           src/features/picker/                                  │  store de Zustand + casos de uso
├──────────────────────────────────────────────────────────────┤
│ Services  src/services/ai (cliente /parse) · speech · haptics   │  todo lo que toca red, hardware o SO
│           image · network                                       │  cada uno detrás de una interfaz (fácil de simular en tests)
├──────────────────────────────────────────────────────────────┤
│ Data      src/data/ (db.ts, migrations, repos, seed)            │  expo-sqlite, única fuente de verdad persistente
├──────────────────────────────────────────────────────────────┤
│ Domain    src/domain/ (engine de progresión, comparación,       │  TypeScript puro: sin React, sin expo, sin I/O
│           búsqueda difusa de ejercicios, formato de series)      │  100 % testeable
└──────────────────────────────────────────────────────────────┘
shared/contract.ts   ← esquema zod de /parse, importado por la app y por el worker
```

Reglas:
- `domain/` no importa nada del proyecto salvo tipos. Si algo necesita la fecha de hoy, se le pasa como parámetro.
- Los componentes **no** llaman a SQLite ni a la red: todo pasa por el controlador de la feature.
- Los servicios se inyectan en el controlador (un objeto `deps`), y en tests se reemplazan por versiones falsas.

### 4.2 Rutas (expo-router)

```
app/_layout.tsx          SQLiteProvider (onInit = migraciones + seed en dev) + tema oscuro
app/index.tsx            Pantalla 1 · elegir músculo
app/session.tsx          Pantallas 2–7: una sola ruta cuyo contenido depende del estado de la sesión
```

Las pantallas 2–7 son **estados de una misma pantalla**, no rutas distintas. Así la burbuja sube desde el input, la lista se transforma y el verde inunda sin cortes de navegación. "Cerrar" en el resumen → `router.replace('/')`.

Al abrir la app con una sesión sin cerrar (`session.ended_at IS NULL`), va directo a `/session` y la restaura.

### 4.3 Máquina de estados de la sesión

```
            ┌────────── texto vacío ──────────┐
            ▼                                 │
  ready ──escribe──▶ typing ──enviar──▶ sending ──ok──▶ feedback ──4.5 s──▶ ready
    │                  ▲                  │  │                                  
    │                  └── error/sin red ─┘  └─ambiguo──▶ disambiguating ──elige──▶ feedback
    │
    └──stop mantenido 1.5 s──▶ ending (inundación) ──2.1 s──▶ summary ──cerrar──▶ (ruta /)
```

- Se implementa como un **reducer puro** (`sessionReducer(state, event)`) dentro del store de Zustand. El reducer se testea sin React.
- Los efectos (llamar a /parse, guardar, vibrar) viven en el controlador, que despacha eventos al terminar.
- `sending` no bloquea: si se envía otra cosa mientras tanto, se encola.

### 4.4 Flujo de un mensaje

```
UI: onSend(text | image | voz→texto)
 └▶ controller.send()
     1. repo.entries.insertPending(raw_text)            → la burbuja aparece YA (optimista)
     2. contexto = repo.exercises.forContext(grupos)     (id, nombre, alias, última marca)
     3. ai.parse({ text, image, context })               → zod valida la respuesta
     4. según intent:
        log        → por cada entrada: crear ejercicio si es nuevo → repo.entries.resolve(...)
                     → domain.compare(último registro, hoy) → delta
                     → domain.nextTarget(historial)        → meta para las sugeridas
                     → dispatch(FEEDBACK { delta, texto de plantilla })
        ambiguous  → dispatch(DISAMBIGUATE { opciones })    (la entrada queda status='ambiguous')
        end_session→ dispatch(SHOW_STOP_TIP)
        unclear    → dispatch(REPLY) y la entrada pendiente se borra
     5. error de red → la entrada queda 'pending' y la cola la reintenta (NetInfo)
```

### 4.5 Qué vive dónde

| Dato | Dónde | Por qué |
|---|---|---|
| Ejercicios, sesiones, entradas | SQLite | Persistente, fuente de verdad |
| Estado de la sesión activa (fase, burbuja, sugerencias, texto) | Zustand | Efímero y reactivo. Se reconstruye desde SQLite si la app se cierra |
| Metas del día | Calculadas al vuelo con `domain/` | Nunca se guardan: siempre salen del historial, así un cambio en el algoritmo aplica solo |
| `deviceId` (para el rate limit) | expo-secure-store | Se genera en el primer arranque |

### 4.6 Worker

```
worker/src/index.ts     router mínimo: POST /parse, todo lo demás 404
worker/src/parse.ts     valida la request (zod) → rate limit → arma el prompt → llama a Claude → valida la salida
worker/src/prompt.ts    system prompt + ejemplos (las frases del seed)
shared/contract.ts      el mismo esquema zod que usa la app; de ahí sale el JSON Schema para structured outputs
```

Sin estado ni base de datos. Todo lo que necesita (la lista de ejercicios del usuario) le llega en la request.

### 4.7 Estructura del repo

```
app/                      rutas (expo-router)
src/domain/               engine/, compare.ts, match.ts (búsqueda difusa), format.ts   ← docs/PROGRESSION.md
src/data/                 db.ts, migrations/, repos/{exercises,sessions,entries}.ts, seed.ts
src/services/             ai.ts, speech.ts, haptics.ts, image.ts, network.ts
src/features/session/     reducer.ts, store.ts, controller.ts, templates.ts (frases de feedback)
src/features/picker/      store.ts, controller.ts
src/ui/                   tokens.ts, copy.ts, components/ (Bubble, StopButton, Flood, MuscleList, SuggestRow…)
shared/contract.ts        esquema zod de /parse
worker/                   Cloudflare Worker (wrangler)
docs/PROGRESSION.md
design/flow.html          mockups aprobados
dev/seed.json             historial real para desarrollo
dev/progression_sim.py    implementación de referencia del motor (Python)
```

### 4.8 Tests por capa

| Capa | Qué se prueba | Herramienta |
|---|---|---|
| domain | Motor con los casos de PROGRESSION.md, comparación, búsqueda difusa | Jest |
| features | Reducer (todas las transiciones) y controlador con `deps` falsos (IA que responde ambiguo, red caída…) | Jest |
| data | Migraciones y repos contra SQLite en memoria | Jest + expo-sqlite mock |
| worker | Las 32 frases del seed → JSON esperado | Vitest + `wrangler dev` |
| UI | Solo smoke tests de las pantallas; las animaciones se validan a mano | React Native Testing Library |

## 5. Motor de progresión

Está especificado en `docs/PROGRESSION.md`, con evidencia y parámetros. Resumen:
- Doble progresión por ejercicio. Rango según tipo: `compound_heavy` 6–10, `compound` 8–12, `isolation` 10–15, `calf` 12–20.
- Sube el peso cuando **todas** las series llegan al tope, siempre que el salto sea "absorbible" (Epley, ≤ +5 %). Si no lo es, extiende el tope +5.
- Orden de reglas: pausa > 28 días → pausa > 14 días → estancado → subir peso → falló una subida → igualar series → +1 rep.
- Comparación del resumen: cada ejercicio contra **su propio último registro**, no contra la sesión anterior.
- Personalización por ejercicio: modo confirmar, paso aprendido, rango recentrado, progresión rápida.

**Implementación:** `src/domain/engine/` en TypeScript puro. Porta `dev/progression_sim.py` y **sus casos como tests** (la tabla del §7 de PROGRESSION.md y los casos borde). Este es el primer código que se escribe (hito M1).

## 6. La función (Cloudflare Worker)

### Endpoint `POST /parse`

Request:
```json
{
  "text": "laterales con 10, 4 de 11",
  "image": null,
  "context": {
    "muscle_groups": ["hombro", "tríceps"],
    "exercises": [
      { "id": "laterales_polea", "name": "Elevaciones laterales en polea", "aliases": ["laterales en polea"],
        "muscle_groups": ["hombro"], "last": { "date": "2026-09-27", "load_kg": 7.5, "reps": [10,10,10,10] } }
    ]
  }
}
```
`image`: base64 JPEG ≤ ~1 MB (la app la redimensiona antes) o null.

Response (esquema JSON con structured outputs):
```json
{
  "intent": "log | ambiguous | end_session | question | unclear",
  "entries": [
    { "exercise_id": "laterales_polea",
      "new_exercise": null,
      "load_kg": 10, "reps": [11,11,11,11], "rir_note": null }
  ],
  "ambiguity": { "question": "¿Cuáles laterales?", "options": [ { "exercise_id": "laterales_polea", "label": "En polea" } ] },
  "reply": null
}
```
- `exercise_id` sale **solo** de `context.exercises`. Si no hay coincidencia, va `null` y se llena `new_exercise: { canonical_name, muscle_groups[], kind, load_basis }`.
- **Unificación de nombres:** variaciones del mismo ejercicio ("press de hombros", "press hombro mancuernas") → mismo `exercise_id`. Si la frase sirve para **dos o más** ejercicios distintos del usuario → `intent: "ambiguous"` con opciones. Nunca fusionar historiales dudosos.
- Normalizar: "4 de 9" → `[9,9,9,9]`; "3 de 11 y la última de 9" → `[11,11,11,9]`; "a cada lado" → `load_basis: per_side`; "7,5" → 7.5. Si no dicen kg, se asume kg.
- Si falta el peso o las reps → `ambiguous` con una pregunta concreta. No inventar valores.
- Si el JSON no valida en la app → se trata como `unclear`.
- Verifica en la documentación qué subconjunto de JSON Schema soporta structured outputs (por ejemplo, nulos y `anyOf`) antes de fijar el esquema.

### Seguridad y costo

- `ANTHROPIC_API_KEY` con `wrangler secret put`. **Nunca** en el bundle de la app.
- **Límite de uso:** usa el binding de Rate Limiting de Workers (Wrangler ≥ 4.36):
  ```jsonc
  "ratelimits": [{ "name": "PARSE_LIMITER", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } }]
  ```
  con `env.PARSE_LIMITER.limit({ key: deviceId })`. El `deviceId` es un UUID generado en el primer arranque.
- Un header `X-App-Token` solo sirve para disuadir; no es seguridad real, porque va dentro de la app. Está bien para el MVP; la autenticación real llega con cuentas.
- `max_tokens` bajo (~400) y un timeout de 15 s.

### Tests del worker

`dev/seed.json` trae **32 frases reales** de Jason en `entries[].raw_text`, con el resultado correcto. Úsalas como fixtures: cada frase debe parsear al `exercise_id`, `load_kg` y `reps` esperados. Las 2 entradas con `load_kg: null` (curl martillo del 15 sep, máquina lumbar) no dicen el peso: lo esperado es `intent: "ambiguous"` con una pregunta por el peso. Agrega casos ambiguos, por ejemplo "laterales con 10" con tres laterales en el contexto.

## 7. Modelo de datos (SQLite)

```sql
CREATE TABLE exercise (
  id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',   -- JSON
  muscle_groups TEXT NOT NULL,                                                              -- JSON
  kind TEXT NOT NULL CHECK (kind IN ('compound_heavy','compound','isolation','calf')),
  rep_floor INTEGER NOT NULL, rep_top INTEGER NOT NULL, step_kg REAL NOT NULL,
  load_basis TEXT NOT NULL CHECK (load_basis IN ('per_side','per_dumbbell','total','stack')),
  created_at TEXT NOT NULL
);
CREATE TABLE session (
  id TEXT PRIMARY KEY, muscle_groups TEXT NOT NULL,          -- JSON, en el orden elegido
  started_at TEXT, ended_at TEXT, avg_bpm INTEGER
);
CREATE TABLE entry (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id),
  exercise_id TEXT REFERENCES exercise(id),                -- NULL mientras está pendiente o ambigua
  load_kg REAL, reps TEXT,                                 -- JSON [11,11,11,9]
  raw_text TEXT NOT NULL, rir_note TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','pending','ambiguous')),
  created_at TEXT NOT NULL
);
CREATE INDEX entry_exercise_created ON entry(exercise_id, created_at);
```
- `reps` siempre como lista por serie.
- `session.started_at` = hora de la **primera entrada**. `ended_at` = cuando se completa el stop.
- `dev/seed.json` sigue este mismo modelo. Cárgalo solo en desarrollo (por ejemplo, con un flag `EXPO_PUBLIC_SEED=1`).

## 8. Pantallas (ver `design/flow.html`)

### 1 · Elegir músculo
- Título "¿Qué toca hoy?" y subtítulo "Primero lo que más tiempo lleva sin entrenar. El orden en que tocas es el orden de la sesión."
- **Lista tipográfica** (no chips): nombre del grupo en 30/800, fecha de la última vez a la derecha (13/600, muted). Orden: fecha más antigua primero; los "sin registro" al final.
- Tocar selecciona o deselecciona. El seleccionado se pone verde y muestra **su número de orden** grande en verde (1, 2…), sin check. Al quitar uno, los demás se renumeran.
- "Otro…" al final abre un input para escribir un grupo propio.
- El botón "EMPEZAR · Hombro + Tríceps" aparece solo con ≥ 1 seleccionado.
- Grupos base: Pecho, Espalda, Bíceps, Tríceps, Hombro, Pierna, Glúteo, Pantorrilla, Core, Cardio.

### 2 · Primer ejercicio
- El teclado se abre solo (`autoFocus`). Título "¿Con qué empiezas?" pegado al input.
- Arriba, en muted: "<grupos> · tu última vez, <fecha>" con la lista de ejercicios de la última sesión que tuvo esos grupos (nombre izquierda, "peso · series×reps" derecha).
- Placeholder: "press de hombro, 24 kg, 4 de 8". Micrófono dentro del input.

### 3 · Escribiendo
- Sugerencias **locales** (SQLite, búsqueda difusa sobre nombre y alias, priorizando los grupos elegidos). **Sin IA por tecla.**
- Hasta 2–3 filas encima del input: el nombre con la parte coincidente en negrita, y "Última: 24 kg · 4×8 · 27 sep".
- Tocar una sugerencia reemplaza el texto por el nombre canónico + ", " y deja el cursor para los números.
- Con texto, el micrófono se convierte en el botón **enviar** (círculo verde, flecha, tinta).

### 4 · Anotado (animado)
Secuencia al enviar:
1. El texto **sube desde el input** como burbuja alineada a la derecha (surface, radio 18/18/6/18). El input se vacía, el teclado se cierra, el título cambia a "¿Qué sigue?" y vuelve el micrófono.
2. Bajo la burbuja: "✓ Anotado · +1 rep por serie vs. el 27" (verde si subió, muted si igual/bajó, "primera vez, queda como referencia" si es nuevo).
3. A los **4.5 s** (parámetro) la burbuja se desvanece y en la lista de arriba ese ejercicio pasa a check verde con la marca de hoy y el delta.

Mientras espera la respuesta de la función: la burbuja aparece enseguida con un estado de "pendiente" sutil.

La lista tiene dos secciones: **"Hoy"** (lo anotado, cada uno con "vs. <fecha de su último registro>") y **"Sugeridos de tu última vez"** (lo que falta, en muted). Un ejercicio anotado que no estaba en la lista se agrega a "Hoy".

### 5 · Si hay duda
- Tu frase entre comillas, la pregunta ("¿Cuáles laterales?") y **botones con cada opción** mostrando su última carga. Abajo: "U otra cosa, dímelo".

### 6 · Terminar (mantener presionado)
- Barra de sesión, visible desde la primera entrada: grupo (20/700), cronómetro (17/700, tabular) y **botón stop** circular de 52 px (surface, cuadrado blanco de 16 px con radio 4).
- **Toque corto** (< 400 ms): globo "Mantén para terminar" durante 2.2 s. No termina.
- **Mantener 1.5 s:** anillo verde alrededor del botón, el cuadrado se pone verde, escala 1.12. La **pantalla se llena de verde desde abajo** con aceleración (cubic-bezier(.55,0,.9,.6)), y el contenido se aleja (scale .94) y se desenfoca. Háptica cada vez más fuerte (`impactAsync` Light → Medium → Heavy).
- Soltar antes: el verde baja en 0.35 s y no pasa nada.
- Al completarse: `notificationAsync(Success)`. La pantalla queda **toda verde** y aparecen en escalera, en tinta, "Sesión terminada · 2 subieron · 1 igual · 1 nuevo · 58 min" (46/800). A los 2.1 s el verde se retira hacia abajo y queda el resumen.
- Estado actual: "me sirve por ahora" según Jason. Es candidato a iterar.
- Si la IA detecta "listo/terminamos", **no** termina la sesión: muestra el globo del stop para que el usuario lo mantenga.

### 7 · Resumen
- "Lunes 28 · Hombro · 58 min" (muted), luego el conteo en 34/800: "**2 subieron**" (verde), "1 igual" (text), "1 nuevo/bajó" (muted).
- Filas: nombre, "<fecha de comparación> ~~antes~~ → **hoy**" y el delta a la derecha (+1, +2 kg, =, −1, "nuevo").
- "La próxima vez": la meta más relevante que calcula el motor (una subida de peso o repetir tras un fallo).
- Botón "CERRAR" en surface → vuelve a la pantalla 1.

## 9. Tokens de diseño

```ts
export const color = {
  green:   '#29FF94', // acento: jade 150°, sat 100 %. Solo relleno o texto sobre oscuro; tinta encima (14.5:1)
  bg:      '#100E11', // fondo (muestreado de LADDER)
  raised:  '#1C1A1D', // tarjetas de sugerencias
  surface: '#2B2B2B', // input, botones secundarios, burbuja
  border:  '#4F4D50', // círculos vacíos
  divider: '#403E41',
  text:    '#FCF9FC', // 18.4:1 sobre bg
  muted:   '#7E7C7F', // 4.6:1 sobre bg (AA)
  ink:     '#100E11', // texto sobre verde
};
export const type = {            // fuente del sistema (SF Pro en iOS), nunca una fuente personalizada
  tally:   { size: 34, weight: '800', tracking: -0.025 },
  flood:   { size: 46, weight: '800', tracking: -0.03 },
  muscle:  { size: 30, weight: '800', tracking: -0.025 },
  title:   { size: 20, weight: '700', tracking: -0.01 },
  input:   { size: 17, weight: '500' },
  body:    { size: 16, weight: '500' },
  row:     { size: 15, weight: '400' },
  label:   { size: 13, weight: '600' },           // color muted
  button:  { size: 15, weight: '700', uppercase: true, tracking: 0.02 },
};
export const radius = { input: 16, card: 20, bubble: 18, pill: 999 };
export const space  = { screenX: 20, rowY: 9 };
```
- **Solo modo oscuro** en el MVP.
- Números siempre con `fontVariant: ['tabular-nums']`.
- El verde **nunca** va como texto sobre fondo claro, ni como decoración.
- Nada de tarjetas con aspecto de "pago" (bloque de color con monto grande y badge): Jason lo rechazó explícitamente.

## 10. Orden de construcción

| Hito | Qué | Listo cuando |
|---|---|---|
| M0 | Repo, Expo TS, estructura del §4.7, docs copiados | `npx expo start` corre |
| M1 | `src/domain/` + tests portados de `progression_sim.py` | Los tests reproducen la tabla del §7 de PROGRESSION.md |
| M2 | SQLite: esquema, migraciones, consultas, carga del seed | La app lista los grupos con las fechas reales del seed |
| M3 | Worker `/parse` (Haiku 4.5 + structured outputs + rate limit) | Las 32 frases del seed parsean bien con `wrangler dev`; desplegado |
| M4 | Pantallas 1–3 | Flujo hasta escribir, con sugerencias locales |
| M5 | Pantallas 4–5 | Enviar → animación → guardado → delta. Ambigüedad resuelta con toque |
| M6 | Pantallas 6–7 | Mantener el stop → inundación → resumen con comparación por ejercicio |
| M7 | Voz (development build) y foto | Dictar "press de hombro 24 4 de 9" funciona de punta a punta |
| M8 | Sin conexión, háptica fina, estados vacíos | Uso real en el gym una semana |

Jason quiere **aprender a hacer funciones** con el worker (M3): explícale los pasos (wrangler init, secrets, bindings, deploy) mientras lo construyen, no los hagas en silencio.

## 11. Decisiones pendientes (preguntar a Jason, no asumir)

1. **Dónde se muestra la meta del motor.** Los mockups muestran "tu última vez" en la lista de sugeridos, pero no la meta de hoy. Propuesta: en cada fila sugerida, la meta de hoy como valor principal y la última vez en pequeño. Hay que confirmarlo antes de M4.
2. Duración de la burbuja de "Anotado" (4.5 s) y del mantener (1.5 s): validar en el gym.
3. Animación de terminar: aceptada "por ahora".
4. Idioma y variante del reconocimiento de voz (`es-419`, `es-EC` o el locale del dispositivo).
5. Mascota: fuera del MVP; la línea de feedback es su lugar futuro.

## 12. Convenciones

- TypeScript estricto. `src/domain/` no importa nada de React ni de expo.
- Copys de UI en un solo archivo (`src/ui/copy.ts`), en español.
- No agregues pantallas, menús ni botones que no estén en este documento sin preguntar.
- Cualquier regla nueva de progresión va primero a `docs/PROGRESSION.md`, con su etiqueta [evidencia] o [heurística].
