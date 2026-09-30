# Multiusuario en el MVP — cambio de arquitectura

Decisión de Jason (29 sep 2026): **las cuentas y la sincronización entran al MVP.** Este documento manda sobre `CLAUDE.md` en todo lo que se contradiga. Integra estos cambios en `CLAUDE.md` y en el código de M2.

## 1. Decisión

**Local primero + Supabase (Auth + Postgres) + sincronización propia.**

- El teléfono sigue guardando todo en **SQLite**. Anotar nunca espera a la red: en el gimnasio muchas veces no hay señal.
- **Supabase** es la fuente de verdad en la nube. Aporta cuentas (anónimas, Apple, email), Postgres y **Row Level Security**: cada usuario solo puede leer y escribir sus propias filas.
- Una **sincronización simple hecha por nosotros** (sube lo pendiente, baja lo nuevo) en `src/data/sync.ts`.
- El **Cloudflare Worker** se queda para la IA y ahora verifica la sesión de Supabase.

### Por qué esta opción y no otras

| Opción | Por qué no (para este MVP) |
|---|---|
| Supabase + **PowerSync** (sync gestionado) | Usa op-sqlite en vez de expo-sqlite, así que se tira el trabajo de M2. Agrega otro servicio (el gratis se desactiva tras 1 semana sin uso; Pro desde $49/mes) y sigue requiriendo escribir el conector de subida. Buena opción si la sincronización propia se complica. |
| **InstantDB** / Firebase | Traen offline y auth, pero reemplazan SQLite y las consultas relacionales, y nos atan a su modelo. Se pierde control sobre los datos que usa el motor. |
| Sincronización propia sobre Cloudflare D1 | Habría que construir la autenticación desde cero. Supabase ya la trae, con Sign in with Apple. |

**Por qué basta una sincronización propia:** los datos de cada usuario solo los escribe ese usuario, casi siempre desde un solo teléfono, y son casi todos **inserciones** (series nuevas). Los conflictos reales solo aparecen si el mismo usuario edita lo mismo desde dos dispositivos, y ahí basta con que gane el último que escribió (*last-write-wins*).

## 2. Cuentas

### Flujo

1. **Primer arranque:** `supabase.auth.signInAnonymously()`. El usuario ya tiene un `user_id` y todo se sincroniza, **sin pantalla de login**.
   - Motivo: Apple 5.1.1(v): *"If your app doesn't include significant account-based features, let people use it without a login."* Así no hay muro de login y la app ya es multiusuario desde el día uno.
   - **Sin señal en el primer arranque:** se anota normal; todo queda con `dirty = 1`. Cuando hay señal se crea la cuenta anónima y el sync sube todo. No se reescribe ningún id, porque la base local no guarda `user_id` (§3).
2. **"Guarda tu cuenta"** (más adelante, cuando el usuario quiera): convertir la cuenta anónima en permanente.
   - **Email:** `updateUser({ email })` + código OTP. Documentado por Supabase para cuentas anónimas.
   - **Sign in with Apple nativo** (`expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })`).
   - **Vincular Apple a la cuenta anónima: sí se puede** (verificado el 29 sep 2026 en el código de `@supabase/auth-js` 2.117.2 y `supabase/auth` v2.197.0; la documentación aún no lo muestra). `supabase.auth.linkIdentity({ provider: 'apple', token, nonce })`: el servidor vincula la identidad al usuario de la sesión y le quita `is_anonymous`. El `user_id` no cambia y no hay que resubir nada. Requiere activar **"Enable Manual Linking"**. Hay que probarlo de punta a punta en M2b con un token real.
   - **Plan B, cuando ese Apple ID ya pertenece a otra cuenta** (el servidor responde `identity_already_exists`; por ejemplo, reinstalaste la app y tu Apple ya tenía cuenta). Decidido por Jason el 29 sep 2026. Pasos, **en este orden**:
     1. **Refrescar la sesión anónima** y guardar una copia de su access token (y de su refresh token, para poder reintentar después de que el access token venza). La copia se guarda en el teléfono como "cambio de cuenta pendiente".
     2. `signInWithIdToken({ provider: 'apple', token, nonce })`: entra a la cuenta de Apple (otro `user_id`). Si falla, no se hizo nada: se descarta la copia y se sigue en la cuenta anónima.
     3. `POST /account/delete` **con el token anónimo guardado**. Borra la cuenta anónima y sus filas del servidor caen en cascada. Si no se hiciera, al resubir chocarían los mismos `id` con filas ajenas y RLS lo impediría.
        - **Si el borrado falla, no se resube.** El cambio queda pendiente y se reintenta más tarde (al abrir la app, al volver a primer plano o al recuperar la red). Para reintentar, si el access token guardado ya venció, se pide uno nuevo con el refresh token guardado, sin tocar la sesión de Apple. **Mientras haya un cambio pendiente, el sync no sube nada.**
     4. **Unir ejercicios** con los que ya tiene la cuenta de Apple (ver abajo).
     5. Marcar **todas** las filas locales `dirty = 1`, vaciar `sync_state` (la cuenta es otra y hay que bajarla completa), borrar el cambio pendiente y sincronizar.
   - **Unión de ejercicios** (paso 4): se bajan los ejercicios de la cuenta de Apple. Un ejercicio local se une a uno del servidor **solo si su `canonical_name` normalizado es idéntico**: minúsculas, sin tildes (se quitan los diacríticos, así que la ñ pasa a n) y espacios colapsados, sin espacios al inicio ni al final.
     - Si coinciden: las entradas locales pasan al `id` del servidor, el ejercicio local se reemplaza por el del servidor (sus datos, más los alias de los dos y el nombre local como alias si difería) y el `id` local desaparece.
     - Si no coincide con ninguno: se queda con su `id` y se sube como nuevo.
     - **Nunca se une por similitud difusa** ("Press hombro mancuernas" no se une con "Press de hombro con mancuernas"). Unir historiales dudosos rompe la progresión; un duplicado se arregla después.
     - Los ejercicios borrados del servidor no se usan para unir. Si en el servidor hay dos con el mismo nombre normalizado, se usa el más antiguo. Si en el teléfono hay dos, los dos van al mismo `id`.
     - Las cuentas anónimas que queden huérfanas por otros motivos se limpian con un job SQL.
3. **Otro teléfono:** iniciar sesión → bajar todo.
4. **Cerrar sesión:** sincronizar y, **solo si subió todo** (no queda ninguna fila `dirty = 1`), vaciar la base local (tablas de datos y `sync_state`). Si no hay señal o falla la subida, no se cierra la sesión y se avisa, para no perder lo que no subió.
5. **Borrar cuenta:** obligatorio por Apple 5.1.1(v) (*"If your app supports account creation, you must also offer account deletion within the app"*). Endpoint en el Worker `POST /account/delete`, que verifica el JWT y borra el usuario con la service role key (secreto del Worker). Las filas se borran en cascada desde `auth.users`. Después se vacía la base local.

Guideline 4.8: si algún día se agrega Google u otro login social, hay que ofrecer también Sign in with Apple (o uno equivalente en privacidad). Con Apple + email ya se cumple.

### Cliente

`@supabase/supabase-js` + `@react-native-async-storage/async-storage`, con `createClient(url, publishableKey, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })`. Las variables son `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. La publishable key puede ir en la app; la seguridad la dan las políticas RLS.

## 3. Cambios al esquema

### SQLite (local)

**La base del teléfono es siempre de un solo usuario** (decidido por Jason el 29 sep 2026), así que las tablas locales **no tienen `user_id`**. Quién es el dueño lo decide el servidor con la sesión.

Todas las tablas (`exercise`, `session`, `entry`) agregan:

```sql
updated_at TEXT NOT NULL,          -- ISO, lo pone el cliente en cada cambio
deleted_at TEXT,                   -- borrado suave (sincronizable)
dirty      INTEGER NOT NULL DEFAULT 1   -- 1 = falta subir
```

- **Todos los `id` son UUID v4** (`expo-crypto` → `randomUUID()`), nunca slugs como `curl_barra_z` ni ids autoincrementales: dos usuarios o dos teléfonos no pueden chocar.
- Nueva tabla `sync_state(table_name TEXT PRIMARY KEY, cursor TEXT)`.
- Las consultas del motor y de las pantallas filtran `deleted_at IS NULL`.
- **Seed de desarrollo:** al cargar `dev/seed.json`, mapear cada id de texto a un UUID nuevo (manteniendo las relaciones). Queda todo `dirty = 1`, así que se sube a la cuenta de la sesión como cualquier otra fila.

### Postgres (Supabase), en `supabase/migrations/`

Las mismas tablas, con estas diferencias:
- `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`. **El cliente nunca envía `user_id`**: lo pone Postgres con la sesión del request.
- `server_updated_at timestamptz not null default now()`, actualizado por un **trigger** en cada insert o update. Es el cursor para bajar cambios, y usa el reloj del servidor, así que no depende de la hora del teléfono.
- `reps`, `aliases` y `muscle_groups` como `jsonb`.
- **RLS** activado en las tres tablas:

```sql
alter table entry enable row level security;
create policy "own rows" on entry for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- igual en exercise y session
```

El `with check` impide que alguien escriba filas con un `user_id` ajeno aunque lo mande a mano.

## 4. Sincronización (`src/data/sync.ts`)

**Subir (push):**
1. Por tabla, en orden `exercise → session → entry` (por las claves foráneas): tomar las filas con `dirty = 1`. De `entry`, solo las que tienen `status = 'ok'`.
2. `supabase.from(t).upsert(rows, { onConflict: 'id' })`, sin `user_id` en las filas (lo pone el default).
3. Si responde bien, marcar esas filas como `dirty = 0`, **solo si no cambiaron mientras subían** (mismo `updated_at` que se envió). Si el usuario editó una fila durante la subida, queda `dirty = 1` para la próxima.
4. Mientras haya un cambio de cuenta pendiente (§2, plan B), no se sube nada.

**Bajar (pull):**
1. Por tabla: `select <columnas locales> where server_updated_at > cursor − margen order by server_updated_at, id`, paginado por `(server_updated_at, id)`, así no se pierden filas con la misma hora entre páginas. RLS ya limita a las filas del usuario, y `user_id` no se guarda en el teléfono.
2. Se **leen** en orden `entry → session → exercise` y se **aplican** en una sola transacción en orden `exercise → session → entry`. Como el servidor exige que el padre exista antes que el hijo, cualquier entrada leída ya tiene su sesión y su ejercicio confirmados, y la lectura posterior de los padres los trae.
3. Por cada fila remota: si la local tiene `dirty = 1` y su `updated_at` es más nuevo, gana la local; si no, gana la remota. Las horas se comparan como instantes, no como texto: Postgres devuelve `+00:00` y el teléfono guarda `Z`. Las horas que vienen del servidor se guardan normalizadas (ISO con `Z`).
4. Guardar como cursor el `server_updated_at` más alto que se aplicó, en la misma transacción.

**Margen del cursor: `CURSOR_MARGIN_MS = 60 s`** (constante en `src/data/sync.ts`).
- `server_updated_at` sale de `now()`, que en Postgres es la hora de **inicio** de la transacción, no la del commit. Una transacción que empezó antes pero confirmó después deja una fila con un `server_updated_at` **anterior** a un cursor que ya lo pasó, y un `> cursor` estricto se la saltaría para siempre.
- Por eso cada pull pide desde `cursor − 60 s`. Las escrituras del sync son upserts cortos (milisegundos), así que 60 s cubre de sobra. Volver a aplicar una fila ya aplicada no cambia nada.
- Si alguna vez hubiera transacciones de más de 60 s escribiendo estas tablas (una migración masiva, por ejemplo), hay que agrandar el margen o hacer un pull completo (vaciar `sync_state`).

**Cuándo:**
- Al abrir la app o volver a primer plano.
- Unos segundos después de cada entrada guardada (con debounce).
- Al recuperar la red (NetInfo).
- Nunca bloquea la UI.

**Tests:** simular dos dispositivos con dos SQLite en memoria contra un Supabase falso. Casos: offline → online, el mismo usuario en dos teléfonos, borrado suave que se propaga, cursor que no pierde filas (incluida una fila confirmada tarde con `server_updated_at` anterior al cursor).

**Cerrar sesión** (§2): sync → si queda alguna fila `dirty = 1` (incluidas entradas pendientes o ambiguas, que no se suben), no se cierra y se avisa → vaciar las tablas y `sync_state` → `signOut`. Se vacía **antes** del `signOut`: si la app muriera entre los dos pasos, al abrirla sigue la misma sesión con la base vacía y el próximo sync baja todo de nuevo. Al revés, la base quedaría sin sesión y se subiría a una cuenta anónima nueva.

## 5. Cambios en el Worker

- **Cada request exige** `Authorization: Bearer <access_token de Supabase>`. Se verifica con `jose`:
  ```ts
  const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  const { payload } = await jwtVerify(token, JWKS)   // payload.sub = user_id
  ```
  El proyecto debe usar **claves de firma asimétricas**, que es lo que recomienda Supabase para verificar desde servidores de terceros.
- **Rate limit por usuario:** `env.PARSE_LIMITER.limit({ key: payload.sub })`. Se eliminan el `deviceId` y `X-App-Token`.
- **Abuso con cuentas anónimas:** Supabase limita por defecto la creación de anónimos a 30 por hora por IP. Si hace falta, se agrega Cloudflare Turnstile, que Supabase recomienda.
- Nuevo endpoint `POST /account/delete` (secreto `SUPABASE_SERVICE_ROLE_KEY`).

## 6. Entornos

- El proyecto actual (`eybbfdqbqkajcbzeprsp`) es **solo de desarrollo**: ahí caen las pruebas, el seed y los usuarios anónimos de los tests.
- **Antes de publicar se crea un proyecto de producción aparte**, en el plan Pro, con las mismas migraciones (`supabase link` al proyecto de producción + `supabase db push`) y la misma configuración de Auth: anónimos, vinculación manual, Apple y clave JWT asimétrica.
- La app elige el proyecto por **variables de entorno** (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`): en local salen de `.env.local`, y en los builds, del **perfil de EAS Build** (`development`, `preview`, `production`), cada uno con las suyas. El Worker también tiene un entorno por proyecto, con su propia `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
- Nunca se apunta un build de desarrollo a producción ni al revés.

## 7. Costo

**Supabase gratis:** 500 MB de base de datos y 50.000 usuarios activos al mes. El proyecto se pausa tras 1 semana sin uso: vale para desarrollo, pero no para producción. **Pro: $25/mes** al lanzar. Worker e IA sin cambios (~$0.03 por sesión).

## 8. Hitos nuevos

M0 y M1 no cambian. M2 se reabre:

| Hito | Qué | Listo cuando |
|---|---|---|
| M2a | Esquema local listo para sincronizar: UUID, `updated_at`, `deleted_at`, `dirty`, `sync_state` (sin `user_id`: base de un solo usuario); seed remapeado | Tests de repos verdes: ids UUID, filas nuevas `dirty = 1`, lo borrado no aparece |
| M2b | Proyecto Supabase, migraciones SQL (`user_id default auth.uid()`), RLS, auth anónima en la app | Un usuario anónimo no puede leer ni escribir filas de otro, ni forzar un `user_id` ajeno (probarlo) |
| M2c | `sync.ts` con sus tests de dos dispositivos, cerrar sesión | Offline → online sube todo; un segundo teléfono baja todo; cerrar sesión no borra nada sin subir |
| M3 | Worker `/parse` **con verificación de JWT** y rate limit por usuario, + `/account/delete` | Sin token → 401; las 32 frases parsean bien |
| M4… | Igual que antes | |

Explícale a Jason cada paso de Supabase (proyecto, migraciones con el CLI, RLS, auth), igual que con el Worker.

## 9. Pendiente de diseño (preguntar, no inventar)

- **Dónde vive "Guarda tu cuenta"** y cómo se accede a la cuenta y a "Borrar cuenta". Ninguna pantalla aprobada lo tiene, y hay que diseñarlo antes de construirlo. Propuesta a validar: una invitación discreta en el resumen después de la primera sesión, más un acceso mínimo a la cuenta desde la pantalla 1.

## Fuentes

- Supabase: auth anónima — https://supabase.com/docs/guides/auth/auth-anonymous
- Supabase: Sign in with Apple — https://supabase.com/docs/guides/auth/social-login/auth-apple
- Supabase: verificar JWT (JWKS, jose) — https://supabase.com/docs/guides/auth/jwts
- Supabase con Expo — https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native
- Supabase precios — https://supabase.com/pricing
- PowerSync React Native/Expo — https://docs.powersync.com/client-sdk-references/react-native-and-expo · precios: https://www.powersync.com/pricing
- InstantDB React Native — https://www.instantdb.com/docs/start-rn
- App Store Review Guidelines 4.8 y 5.1.1(v) — https://developer.apple.com/app-store/review/guidelines/
