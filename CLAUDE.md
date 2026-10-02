# unamas — contexto para Claude Code

Nombre de la app: **unamas** (junto, en minúsculas). Slug y carpeta: `unamas`.

Lee este archivo completo antes de escribir código. Los detalles del algoritmo están en `docs/PROGRESSION.md`, los de cuentas y sincronización en `docs/MULTIUSER.md` (manda sobre este archivo si se contradicen), y los mockups aprobados en `design/flow.html` (ábrelo en un navegador; las pantallas 1, 4 y 6 son interactivas).

## 1. Qué es

Una app móvil para registrar el entrenamiento de fuerza **hablándole o escribiéndole como a una persona** ("press de hombro 24 kg, 4 de 9"). La app lo convierte en datos, lo compara con tu última vez y te sugiere la próxima meta con sobrecarga progresiva basada en evidencia.

Principios de producto, decididos con el dueño (Jason):
- **Una pantalla principal conversacional.** Nada de menús ni botones innecesarios, y nada de pantallas genéricas de app de gym.
- **Todo lo importante está siempre visible.** No hay gestos escondidos: si existe un gesto, la UI tiene que mostrar que existe.
- **El verde significa progreso.** Solo aparece para acciones principales y logros.
- **La IA entiende texto; el código decide números.** El algoritmo de progresión es determinista (ver §5).
- **Local primero.** Anotar nunca espera a la red: todo se guarda en el teléfono y se sincroniza después.
- Idioma de la UI: **español**, tono cercano y breve. El código y los identificadores van en inglés.

## 2. Alcance del MVP

**Incluye:** elegir músculos → anotar ejercicios por texto, voz o foto → feedback contra la última vez → sugerencias desde el historial → pregunta cuando algo es ambiguo → terminar la sesión → resumen. **Cuentas y sincronización** (decidido el 29 sep 2026, ver `docs/MULTIUSER.md`): cuenta anónima al primer arranque, sin pantalla de login; más adelante se puede guardar con Apple o email; borrar cuenta dentro de la app.

**Fuera del MVP (decidido):** mascota, volumen semanal por músculo, descargas programadas, pedir RIR/RPE en cada serie, Android pulido (se prioriza iOS, pero sin romper Android), modo claro.

## 3. Stack

| Capa | Elección | Notas verificadas (sep 2026) |
|---|---|---|
| App | **Expo + React Native + TypeScript** | Crear con `npx create-expo-app@latest`, que trae el SDK más reciente |
| Datos locales | **expo-sqlite** | API async: `openDatabaseAsync`, `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`; `SQLiteProvider` + `useSQLiteContext` con `onInit` para migraciones |
| Voz | **expo-speech-recognition** (jamsch) | Necesita **development build** (no funciona en Expo Go). `ExpoSpeechRecognitionModule.requestPermissionsAsync()`, `.start({ lang, interimResults: true })`, `useSpeechRecognitionEvent('result', …)` |
| Háptica | expo-haptics | |
| Foto | expo-image-picker | Para máquinas que el usuario no sabe nombrar |
| Cuentas y nube | **Supabase** (Auth + Postgres + Row Level Security) | `@supabase/supabase-js` + `@react-native-async-storage/async-storage`. Auth anónima al primer arranque; Apple (`expo-apple-authentication` + `signInWithIdToken`) y email para guardar la cuenta. Sincronización propia en `src/data/sync.ts` |
| Backend IA | **Cloudflare Worker**, sin base de datos | Proxy a la API de Claude (guarda la clave como secreto), verifica el JWT de Supabase con `jose` y expone `POST /account/delete` |
| IA | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | $1/MTok de entrada, $5/MTok de salida, con visión. Usa **structured outputs**: `output_config.format = { type: "json_schema", schema }`, sin header beta (`output_format` está deprecado) |
| Tests | Jest (lo trae Expo) para el motor; Vitest en el worker | |

Costo estimado de IA: ~1.500 tokens de entrada + ~150 de salida por mensaje ≈ **$0.002**. Con ~15 mensajes por sesión ≈ **$0.03 por sesión**. Supabase: gratis en desarrollo (se pausa tras 1 semana sin uso), **Pro $25/mes** al lanzar.

**Entornos:** el proyecto de Supabase actual (`eybbfdqbqkajcbzeprsp`) es solo de desarrollo. Antes de publicar se crea uno de producción aparte, y la app elige el proyecto por variables de entorno (`.env.local` en local, el perfil de EAS Build en los builds). Ver `docs/MULTIUSER.md` §6.

Antes de usar cualquier API, verifica en su documentación actual. Las notas de arriba se revisaron el 28 sep 2026.

Librerías extra: `zustand` (estado de la sesión activa), `zod` (validar el contrato con el worker, en ambos lados), `react-native-reanimated` + `react-native-worklets` (animaciones, vienen en Expo), `react-native-svg` (anillo del stop), `expo-blur` (desenfoque al mantener el stop), `@react-native-community/netinfo` (cola sin conexión y sincronizar al recuperar la red), `expo-crypto` (`randomUUID()` para todos los ids).

**Sin ORM:** son 3 tablas (más `sync_state`), así que basta con repositorios tipados sobre expo-sqlite. Drizzle con expo-sqlite hoy se instala en versión RC y pide configuración extra de Babel para las migraciones; no compensa en el MVP.

## 4. Arquitectura de la app

### 4.1 Capas (las dependencias van solo hacia abajo)

```
┌──────────────────────────────────────────────────────────────┐
│ UI   app/ (rutas) + src/ui/ (componentes, animaciones, tokens) │  React, Reanimated
├──────────────────────────────────────────────────────────────┤
│ Feature   src/features/session/                                 │  controlador de sesión (máquina de estados)
│           src/features/picker/                                  │  store de Zustand + casos de uso
├──────────────────────────────────────────────────────────────┤
│ Services  src/services/ai (cliente /parse) · auth (Supabase)    │  todo lo que toca red, hardware o SO
│           speech · haptics · image · network                    │  cada uno detrás de una interfaz (fácil de simular en tests)
├──────────────────────────────────────────────────────────────┤
│ Data      src/data/ (db.ts, migrations, repos, seed, sync.ts)   │  expo-sqlite local; Supabase es la verdad en la nube
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
app/_layout.tsx          SQLiteProvider (onInit = migraciones + seed en dev) + sesión de Supabase (anónima) + tema oscuro
app/index.tsx            Pantalla 1 · elegir músculo
app/session.tsx          Pantallas 2–7: una sola ruta cuyo contenido depende del estado de la sesión
```

Las pantallas 2–7 son **estados de una misma pantalla**, no rutas distintas. Así la burbuja sube desde el input, la lista se transforma y el verde inunda sin cortes de navegación. "Cerrar" en el resumen → `router.replace('/')`.

**La sesión se crea al guardar la primera entrada**, no al tocar EMPEZAR (decidido con Jason). EMPEZAR navega a `/session` con los grupos como parámetro de la ruta: hasta la primera entrada viven solo en memoria. Por eso no existen sesiones vacías: si la app se cierra sin entradas, al abrirla empieza en la pantalla 1.

Al abrir la app con una sesión sin cerrar (`session.ended_at IS NULL`, que siempre tiene entradas), va directo a `/session` y la restaura.

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
     0. si es la primera entrada: repo.sessions.create(grupos)  (started_at = ahora; §7)
     1. repo.entries.insertPending(raw_text)            → la burbuja aparece YA (optimista)
     2. contexto = repo.exercises.forContext(grupos)     (id, nombre, alias, última marca)
     3. ai.parse({ text, image, context })               → zod valida la respuesta
     4. según intent:
        log        → por cada entrada: crear ejercicio si es nuevo → repo.entries.resolve(...)
                     → domain.compare(último registro, hoy) → delta
                     → domain.nextTarget(historial)        → meta para las sugeridas
                     → dispatch(FEEDBACK { delta, texto de plantilla })
        ambiguous  → dispatch(DISAMBIGUATE { opciones })    (la entrada queda status='ambiguous', con la pregunta y
                     las opciones en entry.ambiguity: una duda vieja se vuelve a mostrar desde ahí, sin IA ni señal)
                     → al elegir una opción: learnAliasFromChoice(frase, ejercicio)  (alias aprendido, §6)
        end_session→ dispatch(SHOW_STOP_TIP)
        unclear    → dispatch(REPLY) y la entrada pendiente se borra
     5. error de red → la entrada queda 'pending' (se ve en "Hoy" en gris, "pendiente") y se reintenta
        al abrir la app, al volver a primer plano y al volver la señal: todas, de la más vieja a la más
        nueva y de a una, sin tocar la burbuja ni lo que se está escribiendo; se detiene en la primera
        que siga sin señal. Las de la sesión abierta las reintenta la pantalla de sesión; las de
        sesiones ya terminadas, el layout raíz (`src/features/session/pastSessions.ts`)
     6. unos segundos después, sync sube lo que quedó con dirty = 1 (sin bloquear la UI)
```

### 4.5 Qué vive dónde

| Dato | Dónde | Por qué |
|---|---|---|
| Ejercicios, sesiones, entradas | SQLite, sincronizado con Supabase | Local primero; Supabase es la fuente de verdad entre dispositivos |
| Estado de la sesión activa (fase, burbuja, sugerencias, texto) | Zustand | Efímero y reactivo. Se reconstruye desde SQLite si la app se cierra |
| Metas del día | Calculadas al vuelo con `domain/` | Nunca se guardan: siempre salen del historial, así un cambio en el algoritmo aplica solo |
| Sesión de Supabase (`user_id`, tokens) | AsyncStorage (vía supabase-js) | Anónima desde el primer arranque (o en cuanto haya señal). El `user_id` lo usan el servidor (RLS) y el rate limit; la base local no lo guarda |

### 4.6 Worker

```
worker/src/index.ts     conecta las rutas con el entorno real (JWKS, limitador, Claude, admin de Supabase)
worker/src/app.ts       rutas: POST /parse y POST /account/delete, todo lo demás 404
                        /parse, en este orden: verifica el token (401) → limit() por user_id (429) → valida el cuerpo
                        con zod (400) → Claude → revisa la respuesta. El límite va antes de validar: la basura también cuenta
worker/src/auth.ts      verifica el JWT de Supabase (jose + JWKS) → user_id; sin token o inválido → 401
worker/src/claude.ts    arma el pedido a Haiku (structured outputs), revisa la respuesta, completa opciones y registra el uso
worker/src/prompt.ts    system prompt + ejemplos inventados (las frases del seed son el set de prueba)
worker/src/account.ts   borra el usuario con la clave secreta (las filas caen en cascada)
shared/contract.ts      el mismo esquema zod que usa la app; de ahí sale el JSON Schema para structured outputs
```

Sin estado ni base de datos propia. Todo lo que necesita para /parse (la lista de ejercicios del usuario) le llega en la request.

### 4.7 Estructura del repo

```
app/                      rutas (expo-router)
src/domain/               engine/, compare.ts, match.ts (búsqueda difusa), format.ts   ← docs/PROGRESSION.md
src/data/                 db.ts, migrations/, repos/{exercises,sessions,entries}.ts, seed.ts, sync.ts
src/services/             ai.ts, auth.ts, speech.ts, haptics.ts, image.ts, network.ts
src/features/session/     reducer.ts, store.ts, controller.ts, templates.ts (frases de feedback)
src/features/picker/      store.ts, controller.ts
src/ui/                   tokens.ts, copy.ts, components/ (Bubble, StopButton, Flood, MuscleList, SuggestRow…)
shared/contract.ts        esquema zod de /parse
worker/                   Cloudflare Worker (wrangler)
supabase/migrations/      esquema Postgres + RLS (Supabase CLI)
docs/PROGRESSION.md
docs/MULTIUSER.md
design/flow.html          mockups aprobados
dev/seed.json             historial real para desarrollo
dev/progression_sim.py    implementación de referencia del motor (Python)
```

### 4.8 Tests por capa

| Capa | Qué se prueba | Herramienta |
|---|---|---|
| domain | Motor con los casos de PROGRESSION.md, comparación, búsqueda difusa | Jest |
| features | Reducer (todas las transiciones) y controlador con `deps` falsos (IA que responde ambiguo, red caída…) | Jest |
| data | Migraciones y repos contra SQLite en memoria; sync con dos dispositivos contra un Supabase falso, y de punta a punta contra el proyecto de desarrollo | Jest + SQLite en memoria (`node:sqlite`); `npm run test:sync:remote` |
| worker | Las 32 frases del seed → JSON esperado; sin token → 401 | Vitest + `wrangler dev` |
| RLS | Un usuario no puede leer ni escribir filas de otro, ni forzar un `user_id` ajeno | Migraciones en Postgres real con PGlite (`npm run test:db`, sin Docker) + chequeo contra el proyecto real (`npm run test:db:remote`) |
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

Toda request lleva `Authorization: Bearer <access_token de Supabase>`.

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
      "load_kg": 10, "reps": [11,11,11,11], "rir_note": null, "easy": false }
  ],
  "ambiguity": { "question": "¿Cuáles laterales?", "options": [ { "exercise_id": "laterales_polea", "label": "En polea" } ] },
  "reply": null
}
```
- `exercise_id` sale **solo** de `context.exercises`. Si no hay coincidencia, va `null` y se llena `new_exercise: { canonical_name, muscle_groups[], kind, load_basis }`, con un `canonical_name` corto (~28 caracteres, §7).
- **Unificación de nombres:** variaciones del mismo ejercicio ("press de hombros", "press hombro mancuernas") → mismo `exercise_id`. Si la frase sirve para **dos o más** ejercicios distintos del usuario → `intent: "ambiguous"` con opciones. Nunca fusionar historiales dudosos.
- **Alias aprendidos:** cuando el usuario elige una opción en una pregunta de "¿cuál ejercicio?" (pantalla 5), su frase **sin números** se guarda como alias del ejercicio elegido (`src/domain/names.ts` → `phraseToAlias`, `src/features/session/aliases.ts`): minúsculas, sin tildes, sin pesos, unidades, series×reps, "a cada lado" ni notas de esfuerzo ("jalones en la polea arriba para hombro posterior, con 25, 4 de 12" → "jalones en la polea arriba para hombro posterior"). Así la próxima vez esas palabras se resuelven directo. No se agrega si ya es el nombre o un alias de **otro** ejercicio (un alias apunta a un solo ejercicio), ni cuando la pregunta era por el peso. El ejercicio queda `dirty` y se sincroniza.
- **Foto:** muestra la máquina; "esta" apunta a ella. El ejercicio sale de la foto y el texto; el peso y las reps, **solo del texto** (nunca de números que se vean en la foto). Con foto pero sin peso o reps → `ambiguous` sin opciones, con una pregunta que empieza por el ejercicio reconocido. Si no se reconoce → "¿Qué ejercicio haces en esta máquina?".
- Normalizar: "4 de 9" → `[9,9,9,9]`; "3 de 11 y la última de 9" → `[11,11,11,9]`; "a cada lado" → `load_basis: per_side`; "7,5" → 7.5. Si no dicen kg, se asume kg.
- Si falta el peso o las reps → `ambiguous` con una pregunta concreta. No inventar valores.
- `easy`: `true` solo si dicen "fácil" o que les sobraron 3 o más reps; es la señal que usa el motor para saltarse el modo confirmar (PROGRESSION.md §6). `rir_note` guarda sus palabras tal cual.
- Si el JSON no valida en la app → se trata como `unclear`.
- El Worker, además, revisa el sentido de la respuesta: un `exercise_id` que no está en el contexto, un `log` sin peso o sin reps, o un `new_exercise` vacío → `unclear`. Las opciones de ambigüedad con ids inventados se descartan.
- **Redes por palabras** (un solo ejercicio en la frase; decidido con Jason, 2 oct 2026): (1) si la frase sin números es **exactamente** un nombre o alias de un ejercicio, es ese, sin preguntar, aunque la IA haya elegido otro; (2) si la IA eligió X pero la frase contiene todas las palabras de un nombre o alias de otro ejercicio Y, se pregunta "¿Cuál de estos?" con X e Y, salvo que ese alias de Y esté contenido en uno de X que también calce. Se simulan gratis sobre las 32 frases del seed en `worker/test/nets.spec.ts`. El Worker llama a Claude con `temperature: 0`.
- El esquema de structured outputs se arma en `worker/src/claude.ts` a partir de `shared/contract.ts`, conservando los `enum` (el helper `zodOutputFormat` del SDK los pasa a la descripción).
- Verifica en la documentación qué subconjunto de JSON Schema soporta structured outputs (por ejemplo, nulos y `anyOf`) antes de fijar el esquema.

### Seguridad y costo

- `ANTHROPIC_API_KEY` con `wrangler secret put`. **Nunca** en el bundle de la app.
- **Límite de uso: 30 requests por minuto por usuario**, con un **Durable Object** por usuario (`worker/src/rateLimiter.ts`, `env.RATE_LIMITER.getByName(user_id).hit()`) y una ventana deslizante de 60 s. Las requests de un mismo objeto se atienden de a una, así que el conteo es exacto. Usa almacenamiento SQLite, el único del plan gratis (100.000 requests y 100.000 filas escritas por día; cada `/parse` usa 1 de cada una).
  - Se probó primero el binding de Rate Limiting de Workers (`ratelimits`) y **no limitaba en producción**: 40 requests en un minuto desde una sola ubicación (MIA) dieron `success: true` todas, aunque en `wrangler dev` cortaba en la 31. Por eso se reemplazó (30 sep 2026).
  - Cada request registra `{"event":"rate_limit","success":…}` sin el id del usuario. Además hay un **tope mensual de gasto** en la consola de Anthropic, por si todo lo demás falla.
- **Autenticación:** el JWT de Supabase se verifica con `jose` (`createRemoteJWKSet` sobre `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` + `jwtVerify`). El proyecto de Supabase usa claves de firma asimétricas. Sin token o con uno inválido → 401.
- **Cuentas anónimas:** Supabase limita su creación a 30 por hora por IP. Si hay abuso, se agrega Cloudflare Turnstile.
- **`POST /account/delete`:** verifica el JWT y borra el usuario con `SUPABASE_SERVICE_ROLE_KEY` (secreto del Worker, nunca en la app), que contiene una **clave secreta nueva `sb_secret_…`** en el header `apikey`: Supabase deja de aceptar la `service_role` legacy a fines de 2026. Si el usuario ya no existe responde bien igual (idempotente, para que un plan B reintentado termine). Obligatorio por Apple 5.1.1(v).
- `max_tokens` bajo (400), timeout de 15 s y **sin reintentos en el Worker**: si Claude falla, responde 502 y la app deja la entrada `pending` y reintenta.
- Tests: `npm test` en `worker/` (sin red, dentro de workerd) y `npm run eval` (las 32 frases contra la API real, ~$0.08 por corrida).

### Tests del worker

`dev/seed.json` trae **32 frases reales** de Jason en `entries[].raw_text`, con el resultado correcto. Úsalas como fixtures: cada frase debe parsear al `exercise_id`, `load_kg` y `reps` esperados. Las 2 entradas con `load_kg: null` (curl martillo del 15 sep, máquina lumbar) no dicen el peso: lo esperado es `intent: "ambiguous"` con una pregunta por el peso. Agrega casos ambiguos, por ejemplo "laterales con 10" con tres laterales en el contexto.

## 7. Modelo de datos

Detalle completo y razones en `docs/MULTIUSER.md` §3.

### SQLite (local)

```sql
-- Base de un solo usuario: sin user_id. Todas las tablas de datos llevan updated_at, deleted_at y dirty.
CREATE TABLE exercise (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',                         -- JSON
  muscle_groups TEXT NOT NULL,                                                              -- JSON, claves de shared/muscleGroups.ts
  kind TEXT NOT NULL CHECK (kind IN ('compound_heavy','compound','isolation','calf')),
  rep_floor INTEGER NOT NULL, rep_top INTEGER NOT NULL, step_kg REAL NOT NULL,
  load_basis TEXT NOT NULL CHECK (load_basis IN ('per_side','per_dumbbell','total','stack')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  muscle_groups TEXT NOT NULL,                               -- JSON, en el orden elegido
  started_at TEXT, ended_at TEXT, avg_bpm INTEGER,
  updated_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE entry (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  exercise_id TEXT REFERENCES exercise(id),                -- NULL mientras está pendiente o ambigua
  load_kg REAL, reps TEXT,                                 -- JSON [11,11,11,9]
  raw_text TEXT NOT NULL, rir_note TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','pending','ambiguous')),
  created_at TEXT NOT NULL,
  ambiguity TEXT,                                          -- JSON {question, options[]} mientras está en duda; solo local (v3)
  image_uri TEXT,                                          -- foto de la máquina hasta que se entienda; solo local (v4)
  updated_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE sync_state (table_name TEXT PRIMARY KEY, cursor TEXT);
```
- **Todos los `id` son UUID v4** (`expo-crypto` → `randomUUID()`). Nunca slugs ni autoincrementales.
- **La base del teléfono es siempre de un solo usuario:** no hay `user_id` local. Lo pone Postgres (`default auth.uid()`) y el cliente nunca lo envía. Cerrar sesión = sincronizar y, si subió todo, vaciar la base local.
- `updated_at` lo pone el cliente en cada cambio. `deleted_at` = borrado suave (se sincroniza). `dirty = 1` = falta subir. Sin señal en el primer arranque se anota igual y se sube cuando exista la cuenta anónima.
- Toda consulta del motor y de las pantallas filtra `deleted_at IS NULL`.
- `reps` siempre como lista por serie.
- `entry.ambiguity` no se sincroniza (las entradas en duda no suben) y se limpia al resolverse o al volver a `pending`.
- `entry.image_uri`: la foto vive en `Documents/photos/<entry>.jpg` (≤ 1024 px, JPEG 0,6) hasta que la entrada se entiende; se reenvía en reintentos y respuestas. Al abrir la app se borran las fotos que ninguna entrada necesita. No se sincroniza.
- La fila de `session` se crea **con la primera entrada**: `started_at` = hora de esa entrada. `ended_at` = cuando se completa el stop. No hay sesiones vacías.
- `canonical_name` es **corto** (~28 caracteres, "Laterales en polea"); el detalle ("Elevaciones laterales en polea con cuerda") va en `aliases`. Sin campo nuevo. Para ejercicios nuevos, la IA propone el nombre corto (regla en el prompt) y la app guarda la frase del usuario sin números como alias (M5).
- `dev/seed.json` usa ids de texto legibles. Al cargarlo (solo en desarrollo, con `EXPO_PUBLIC_SEED=1`), cada id se cambia por un UUID nuevo, manteniendo las relaciones. Queda todo `dirty = 1`.

### Postgres (Supabase), en `supabase/migrations/`

Las mismas tablas, con `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade` (el cliente nunca lo envía), `server_updated_at timestamptz` puesto por un trigger (cursor para bajar cambios), `jsonb` para `reps`, `aliases` y `muscle_groups`, y **RLS** en las tres tablas (`using` y `with check` con `user_id = (select auth.uid())`).

## 8. Pantallas (ver `design/flow.html`)

### 1 · Elegir músculo
- **Primero, una duda pendiente de una sesión ya terminada** (decidido con Jason, 1 oct 2026): si una entrada guardada sin señal se resuelve después de cerrar su sesión y sale ambigua, la pregunta aparece aquí antes de la lista, con "De tu sesión del lunes 28 · Hombro", las opciones y "U otra cosa, dímelo". La respuesta va a esa sesión cerrada. "Ahora no" (aprobado por Jason) la deja para la próxima vez que se abra la app.
- Título "¿Qué toca hoy?" y subtítulo "Primero lo que más tiempo lleva sin entrenar. El orden en que tocas es el orden de la sesión."
- **Lista tipográfica** (no chips): nombre del grupo en 30/800, fecha de la última vez a la derecha (13/600, muted). Orden: fecha más antigua primero; los "sin registro" al final.
- Tocar selecciona o deselecciona. El seleccionado se pone verde y muestra **su número de orden** grande en verde (1, 2…), sin check. Al quitar uno, los demás se renumeran.
- "Otro…" al final abre un input para escribir un grupo propio.
- El botón "EMPEZAR · Hombro + Tríceps" aparece solo con ≥ 1 seleccionado. **No crea la sesión**: lleva a la pantalla 2 con los grupos en memoria, y la selección se mantiene por si vuelve.
- Grupos base: Pecho, Espalda, Bíceps, Tríceps, Hombro, Pierna, Glúteo, Pantorrilla, Core, Cardio. **En los datos se guardan como claves neutras** (`chest, back, biceps, triceps, shoulders, legs, glutes, calves, core, cardio`, en `shared/muscleGroups.ts`; decidido con Jason, 1 oct 2026), y las etiquetas en español están en `src/ui/copy.ts`. Un grupo de "Otro…" se guarda como se escribió, salvo que sea el nombre de un grupo base ("pecho" → `chest`). La traducción completa de la app queda para después del MVP.

### 2 · Primer ejercicio
- El teclado se abre solo (`autoFocus`). Título "¿Con qué empiezas?" pegado al input.
- **Volver a la pantalla 1, mientras no haya entradas:** el encabezado de grupos lleva "‹" delante ("‹ Hombro y tríceps · hoy te toca", o solo "‹ Core" si no hay lista) y tocarlo vuelve; el gesto de volver de iOS también. Con la primera entrada desaparecen el "‹" y el gesto.
- Arriba, la **meta de hoy** (decidido con Jason, ver `design/meta.html`): encabezado "<grupos> · hoy te toca" (13/600, muted) y columnas fijas **PESO** y **SERIES** (11/600, mayúsculas, muted), alineadas a la derecha y con números tabulares. Una fila por ejercicio de la última sesión que tuvo esos grupos: el nombre a la izquierda (15, text) y la meta que calcula el motor en las dos columnas (16/700).
  - **Solo el valor que sube va en verde**, con "antes X" debajo en gris (11/500): si sube el peso, PESO en verde ("32.5 kg", "antes 30") y SERIES en blanco sin "antes" (aunque las reps vuelvan al piso); si suben las reps, SERIES en verde ("4×9", "antes 4×8") y PESO en blanco. Lo que no cambia va en blanco y sin "antes".
  - **Si no hay historial para esos grupos, no hay lista.**
- Placeholder del input: **la meta del primer ejercicio sugerido**, en el formato en que se dicta ("press de hombros, 24 kg, 4 de 9"). Sin lista, el genérico "press de hombro, 24 kg, 4 de 8". Micrófono dentro del input.

### 3 · Escribiendo
- Sugerencias **locales** (SQLite, búsqueda difusa sobre nombre y alias, priorizando los grupos elegidos). **Sin IA por tecla.**
- Hasta 2–3 filas encima del input: el nombre con la parte coincidente en negrita, y "Última: 24 kg · 4×8 · 27 sep".
- Tocar una sugerencia reemplaza el texto por el nombre canónico + ", " y deja el cursor para los números.
- Con texto, el micrófono se convierte en el botón **enviar** (círculo verde, flecha, tinta).

### 4 · Anotado (animado)
Secuencia al enviar:
1. El texto **sube desde el input** como burbuja alineada a la derecha (surface, radio 18/18/6/18). El input se vacía, el teclado se cierra, el título cambia a "¿Qué sigue?" y vuelve el micrófono.
2. Bajo la burbuja: "✓ Anotado · +1 rep por serie vs. el 27" (check y texto en verde si subió; check en surface y texto muted si igual o bajó). Un ejercicio nuevo: "Anotado · Press de pecho en máquina · primera vez", con el nombre que recibió y **en gris, nunca en verde** (no es progreso).
3. A los **4.5 s** (parámetro) la burbuja se desvanece y en la lista de arriba ese ejercicio pasa a check verde con la marca de hoy y el delta.
4. **Deshacer** (decidido con Jason, 2 oct 2026): al final de la línea "Anotado", visible solo esos 4,5 s, subrayado y nunca verde. Deshace **el mensaje entero**: sus entradas, el ejercicio que creó (si nada más lo usa), el alias que enseñó al elegir una opción, y su sesión si era la primera entrada (vuelve el "‹"). Borrado suave, porque puede haberse sincronizado ya. La frase (y la foto) vuelven al input para corregir y reenviar. Háptica suave. Pasados los 4,5 s se borra desde "Hoy" (abajo).
5. **Borrar desde "Hoy"** (decidido con Jason, 2 oct 2026): tocar una fila muestra "Borrar" en lugar de su valor (tocarla otra vez lo oculta); tocar "Borrar" borra esa entrada como Deshacer: su ejercicio si nada más lo usa y la sesión si queda vacía. Sin diálogo de confirmación (ya son dos toques). No quita un alias aprendido (una fila no sabe cuál enseñó; un alias de más no hace daño). Una fila pendiente también se borra (nunca subió: se elimina).

Mientras espera la respuesta de la función: la burbuja aparece enseguida con un estado de "pendiente" sutil.

La lista tiene dos secciones: **"Hoy"** (lo anotado, cada uno con "vs. <fecha de su último registro>") y **"Sugeridos de tu última vez"** (lo que falta, en muted). Un ejercicio anotado que no estaba en la lista se agrega a "Hoy".

### Voz y foto (M7, ver `design/photo.html`)
- **Micrófono:** tocarlo empieza a dictar; lo que oye aparece en el input **para revisar**. **Nunca se envía solo** (decidido con Jason): tocar el micrófono otra vez solo deja de escuchar (mientras escucha, el botón es verde con el micrófono en tinta), y se envía con el botón de enviar. Idioma del reconocimiento: **el del teléfono** si es un español que el reconocedor tiene; si no, `es-419` (decidido con Jason). Sus nombres de ejercicios van como pistas al reconocedor.
- **Cámara siempre visible** junto al micrófono o al enviar (no desaparece al escribir). Abre la cámara (en el simulador, la fototeca). La foto queda como **miniatura con × dentro del input** y se envía junto con el texto. Mientras hay foto, en lugar del título: "Dile peso y series; la máquina la reconoce de la foto." Con foto, enviar se activa aunque no haya texto.
- **Burbuja con foto:** miniatura arriba y el texto debajo (o solo la miniatura).
- **Foto sin peso o series:** la IA nombra el ejercicio y pregunta lo que falta ("Press de pecho en máquina. ¿Con cuánto peso y cuántas series?"); la respuesta se envía con la misma foto.
- Las palabras de un mensaje con foto ("esta, 25 a cada lado") no se guardan como alias: apuntan a la foto.

### 5 · Si hay duda
- Tu frase entre comillas, la pregunta ("¿Cuáles laterales?") y **botones con cada opción** mostrando su última carga. Abajo: "U otra cosa, dímelo".
- Al tocar una opción, la frase (sin números) queda como alias de ese ejercicio: la próxima vez no pregunta (§6, "Alias aprendidos").

### 6 · Terminar (mantener presionado)
- Barra de sesión, visible desde la primera entrada: grupo (20/700), cronómetro (17/700, tabular) y **botón stop** circular de 52 px (surface, cuadrado blanco de 16 px con radio 4).
- **Toque corto** (< 400 ms): globo "Mantén para terminar" durante 2.2 s. No termina.
- **Mantener 1.5 s:** anillo verde alrededor del botón, el cuadrado se pone verde, escala 1.12. La **pantalla se llena de verde desde abajo** con aceleración (cubic-bezier(.55,0,.9,.6)), y el contenido se aleja (scale .94) y se desenfoca. Háptica cada vez más fuerte (`impactAsync` Light → Medium → Heavy).
- Soltar antes: el verde baja en 0.35 s y no pasa nada.
- Al completarse: `notificationAsync(Success)`. La pantalla queda **toda verde** y aparecen en escalera, en tinta, "Sesión terminada · 2 subieron · 1 igual · 1 nuevo · 58 min" (46/800). A los 2.1 s el verde se retira hacia abajo y queda el resumen.
- Estado actual: "me sirve por ahora" según Jason. Es candidato a iterar.
- Si la IA detecta "listo/terminamos", **no** termina la sesión: muestra el globo del stop para que el usuario lo mantenga.
- Se puede terminar con entradas pendientes (decidido con Jason): el resumen cuenta solo lo anotado y muestra "1 pendiente, se anota cuando haya señal".
- El desenfoque usa `expo-blur` (`BlurView` con la intensidad animada al ritmo del verde), porque `filter: blur` de React Native es solo Android 12+. La barra con el stop no se desenfoca.

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
| M2 | SQLite: esquema, migraciones, consultas, carga del seed | La app lista los grupos con las fechas reales del seed ✓ |
| M2a | Esquema local listo para sincronizar: UUID, `updated_at`, `deleted_at`, `dirty`, `sync_state` (sin `user_id`: base de un solo usuario); seed remapeado | Tests de repos verdes: ids UUID, filas nuevas `dirty = 1`, lo borrado no aparece ✓ |
| M2b | Proyecto Supabase, migraciones SQL (`user_id default auth.uid()`), RLS, auth anónima en la app | Un usuario anónimo no puede leer ni escribir filas de otro, ni forzar un `user_id` ajeno (probado) ✓ |
| M2c | `sync.ts` con sus tests de dos dispositivos, cerrar sesión | Offline → online sube todo; un segundo teléfono baja todo; cerrar sesión no borra nada sin subir ✓ |
| M3 | Worker `/parse` (Haiku 4.5 + structured outputs) **con verificación de JWT** y rate limit por usuario, + `/account/delete` | Sin token → 401; las 32 frases del seed parsean bien con `wrangler dev`; desplegado ✓ (y `/account/delete` probado con cascada real) |
| M4 | Pantallas 1–3 | Flujo hasta escribir, con sugerencias locales |
| M5 | Pantallas 4–5 | Enviar → animación → guardado → delta. Ambigüedad resuelta con toque ✓ |
| M6 | Pantallas 6–7 | Mantener el stop → inundación → resumen con comparación por ejercicio |
| M7 | Voz (development build) y foto | Dictar "press de hombro 24 4 de 9" funciona de punta a punta |
| M8 | Sin conexión, háptica fina, estados vacíos | Uso real en el gym una semana |

Jason quiere **aprender a hacer funciones** con el worker (M3) y a usar Supabase (M2b): explícale los pasos (wrangler init, secrets, bindings, deploy; proyecto de Supabase, migraciones con el CLI, RLS, auth) mientras lo construyen, no los hagas en silencio.

## 11. Decisiones pendientes (preguntar a Jason, no asumir)

1. ~~**Dónde se muestra la meta del motor.**~~ **Resuelto** (`design/meta.html`, §8 pantalla 2): columnas PESO y SERIES con la meta de hoy; solo lo que sube va en verde con "antes X".
2. Duración de la burbuja de "Anotado" (4.5 s) y del mantener (1.5 s): validar en el gym.
3. Animación de terminar: aceptada "por ahora".
4. ~~Idioma del reconocimiento de voz.~~ **Resuelto:** el del teléfono, con `es-419` de respaldo (§8, "Voz y foto").
5. Mascota: fuera del MVP; la línea de feedback es su lugar futuro.
6. **Pantallas de cuenta** ("Guarda tu cuenta", acceso a la cuenta, "Borrar cuenta"): ninguna pantalla aprobada las tiene. **No diseñarlas ni construirlas sin Jason.** Propuesta a validar en `docs/MULTIUSER.md` §9.

## 12. Convenciones

- TypeScript estricto. `src/domain/` no importa nada de React ni de expo.
- Copys de UI en un solo archivo (`src/ui/copy.ts`), en español.
- No agregues pantallas, menús ni botones que no estén en este documento sin preguntar.
- Cualquier regla nueva de progresión va primero a `docs/PROGRESSION.md`, con su etiqueta [evidencia] o [heurística].
