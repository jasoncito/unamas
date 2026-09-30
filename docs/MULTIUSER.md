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
   - **Plan B, cuando ese Apple ID ya pertenece a otra cuenta** (el servidor responde `identity_already_exists`; por ejemplo, reinstalaste la app y tu Apple ya tenía cuenta): `signInWithIdToken` (entra a esa cuenta, `user_id` distinto) → marcar **todas** las filas locales `dirty = 1` → el sync las sube a la cuenta nueva.
     - ⚠️ **Choque de ids:** esas filas siguen en el servidor con los mismos `id`, pero son de la cuenta anónima anterior. El upsert chocaría con la clave primaria y RLS no deja actualizar filas ajenas, así que la subida fallaría. **Propuesta (a confirmar con Jason):** antes de resubir, borrar la cuenta anónima anterior con su propio token, que sigue vigente unos minutos, vía `POST /account/delete`. Sus filas caen en cascada y la subida ya no choca. Como todo está en el teléfono, no se pierde nada.
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
3. Si responde bien, marcar esas filas como `dirty = 0`.

**Bajar (pull):**
1. Por tabla: `select <columnas locales> where server_updated_at > cursor order by server_updated_at`. RLS ya limita a las filas del usuario, y `user_id` no se guarda en el teléfono.
2. Por cada fila remota: si la local tiene `dirty = 1` y su `updated_at` es más nuevo, gana la local; si no, gana la remota.
3. Guardar el nuevo cursor en `sync_state`.

**Cuándo:**
- Al abrir la app o volver a primer plano.
- Unos segundos después de cada entrada guardada (con debounce).
- Al recuperar la red (NetInfo).
- Nunca bloquea la UI.

**Tests:** simular dos dispositivos con dos SQLite en memoria contra un Supabase falso. Casos: offline → online, el mismo usuario en dos teléfonos, borrado suave que se propaga, cursor que no pierde filas.

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

## 6. Costo

**Supabase gratis:** 500 MB de base de datos y 50.000 usuarios activos al mes. El proyecto se pausa tras 1 semana sin uso: vale para desarrollo, pero no para producción. **Pro: $25/mes** al lanzar. Worker e IA sin cambios (~$0.03 por sesión).

## 7. Hitos nuevos

M0 y M1 no cambian. M2 se reabre:

| Hito | Qué | Listo cuando |
|---|---|---|
| M2a | Esquema local listo para sincronizar: UUID, `updated_at`, `deleted_at`, `dirty`, `sync_state` (sin `user_id`: base de un solo usuario); seed remapeado | Tests de repos verdes: ids UUID, filas nuevas `dirty = 1`, lo borrado no aparece |
| M2b | Proyecto Supabase, migraciones SQL (`user_id default auth.uid()`), RLS, auth anónima en la app | Un usuario anónimo no puede leer ni escribir filas de otro, ni forzar un `user_id` ajeno (probarlo) |
| M2c | `sync.ts` con sus tests de dos dispositivos, cerrar sesión | Offline → online sube todo; un segundo teléfono baja todo; cerrar sesión no borra nada sin subir |
| M3 | Worker `/parse` **con verificación de JWT** y rate limit por usuario, + `/account/delete` | Sin token → 401; las 32 frases parsean bien |
| M4… | Igual que antes | |

Explícale a Jason cada paso de Supabase (proyecto, migraciones con el CLI, RLS, auth), igual que con el Worker.

## 8. Pendiente de diseño (preguntar, no inventar)

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
