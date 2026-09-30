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
2. **"Guarda tu cuenta"** (más adelante, cuando el usuario quiera): convertir la cuenta anónima en permanente.
   - **Email:** `updateUser({ email })` + código OTP. Documentado por Supabase para cuentas anónimas.
   - **Sign in with Apple nativo** (`expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })`).
   - ⚠️ **Verificar** si Supabase permite **vincular** un id token nativo de Apple a un usuario anónimo. Su documentación muestra `linkIdentity` solo con el flujo OAuth web.
   - **Plan B si no se puede:** iniciar sesión con Apple (sale un `user_id` nuevo) → reescribir `user_id` en todas las filas locales → marcarlas como pendientes → subir. Como todo vive en el teléfono, el plan B es barato. Las cuentas anónimas huérfanas se limpian con un job SQL.
3. **Otro teléfono:** iniciar sesión → bajar todo.
4. **Borrar cuenta:** obligatorio por Apple 5.1.1(v) (*"If your app supports account creation, you must also offer account deletion within the app"*). Endpoint en el Worker `POST /account/delete`, que verifica el JWT y borra el usuario con la service role key (secreto del Worker). Las filas se borran en cascada desde `auth.users`.

Guideline 4.8: si algún día se agrega Google u otro login social, hay que ofrecer también Sign in with Apple (o uno equivalente en privacidad). Con Apple + email ya se cumple.

### Cliente

`@supabase/supabase-js` + `@react-native-async-storage/async-storage`, con `createClient(url, publishableKey, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })`. Las variables son `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. La publishable key puede ir en la app; la seguridad la dan las políticas RLS.

## 3. Cambios al esquema

### SQLite (local)

Todas las tablas (`exercise`, `session`, `entry`) agregan:

```sql
user_id    TEXT NOT NULL,          -- auth.uid()
updated_at TEXT NOT NULL,          -- ISO, lo pone el cliente en cada cambio
deleted_at TEXT,                   -- borrado suave (sincronizable)
dirty      INTEGER NOT NULL DEFAULT 1   -- 1 = falta subir
```

- **Todos los `id` son UUID v4** (`expo-crypto` → `randomUUID()`), nunca slugs como `curl_barra_z` ni ids autoincrementales: dos usuarios o dos teléfonos no pueden chocar.
- Nueva tabla `sync_state(table_name TEXT PRIMARY KEY, cursor TEXT)`.
- Las consultas del motor y de las pantallas filtran `deleted_at IS NULL AND user_id = :me`.
- **Seed de desarrollo:** al cargar `dev/seed.json`, mapear cada id de texto a un UUID nuevo (manteniendo las relaciones) y asignar el `user_id` actual.

### Postgres (Supabase), en `supabase/migrations/`

Las mismas tablas, con estas diferencias:
- `user_id uuid not null references auth.users(id) on delete cascade`
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

## 4. Sincronización (`src/data/sync.ts`)

**Subir (push):**
1. Por tabla, en orden `exercise → session → entry` (por las claves foráneas): tomar las filas con `dirty = 1`. De `entry`, solo las que tienen `status = 'ok'`.
2. `supabase.from(t).upsert(rows, { onConflict: 'id' })`.
3. Si responde bien, marcar esas filas como `dirty = 0`.

**Bajar (pull):**
1. Por tabla: `select * where server_updated_at > cursor order by server_updated_at`.
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
| M2a | Esquema local multiusuario: UUID, `user_id`, `updated_at`, `deleted_at`, `dirty`, `sync_state`; seed remapeado | Tests de repos verdes con dos `user_id` que no se mezclan |
| M2b | Proyecto Supabase, migraciones SQL, RLS, auth anónima en la app | Un usuario anónimo no puede leer filas de otro (probarlo) |
| M2c | `sync.ts` con sus tests de dos dispositivos | Offline → online sube todo; un segundo teléfono baja todo |
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
