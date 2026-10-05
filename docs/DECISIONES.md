# Decisiones tomadas por Claude (terminar el MVP, 2 oct 2026)

Jason pidió terminar el MVP sin aprobación paso a paso, decidiendo con el criterio de CLAUDE.md. Estas son las decisiones que no salieron de él. Cualquiera se puede revertir.

## Borrar desde "Hoy"
- Tocar una fila muestra **"Borrar"** en lugar de su valor; tocarla otra vez lo oculta. **Sin diálogo de confirmación**: ya son dos toques, y CLAUDE.md pide nada de menús extra.
- Borra esa entrada como Deshacer: su ejercicio si nada más lo usa, y la sesión si queda vacía. **No quita alias aprendidos**: una fila no sabe qué alias enseñó, y un alias de más no hace daño.
- Una fila pendiente (gris) también se borra; como nunca subió, se elimina del todo.

## M8 · Sin conexión
- Si el teléfono sabe que no tiene conexión (NetInfo), la app **no intenta** llamar a `/parse`: la entrada queda pendiente al instante, en vez de esperar hasta 20 s.
- Mientras no hay señal se ve siempre: "Sin señal: lo que anotes se guarda y se anota cuando vuelva." (principio "todo lo importante está siempre visible").

## M8 · Sesión olvidada abierta
- Una sesión sin entradas en las últimas **4 h** se cierra sola, con `ended_at` = su última entrada, así la duración es la real. Pasa al abrir la app y al volver a primer plano; después se empieza en la pantalla 1. Sin esto, si no se mantiene el stop, al día siguiente la app abría la sesión de ayer.

## M8 · Estados vacíos y detalles
- Resumen sin nada anotado (solo pendientes, o todo borrado): "Nada anotado", en la inundación y en el resumen.
- Háptica: leve al anotar, más firme si subió; de selección al tocar un grupo en la pantalla 1.
- La lista se desliza y el teclado se cierra (`keyboardDismissMode="on-drag"`).
- **Error corregido:** escribir mientras se ve "Anotado" reiniciaba los 4,5 s (y ahora habría vibrado con cada letra). El temporizador depende solo de cada "Anotado" nuevo.

## Evals
- En vez de reportar el recuento proyectado con las redes por palabras, se corrió el eval completo contra el Worker desplegado: **✅ 27 · ⚠️ 5 · ❌ 0** (36/36), $0.1752.
- La línea de ejemplo de "fácil" usa un ejercicio inventado del prompt (remo a una mano), no la frase del eval, para no filtrar la respuesta al test.

## Instalación en el iPhone
- **Build Release** (`--configuration Release`): lleva el JavaScript dentro y funciona sin la Mac. Un development build necesita Metro en la misma red, así que no sirve en el gym. Verificado en el simulador: el bundle (Hermes) incluye la URL del Worker, el proyecto de Supabase y el seed. Expo CLI toma esas variables de tu archivo de variables locales, igual que con `npm run ios`.
- **Con `EXPO_PUBLIC_SEED=1` la primera vez:** el seed es el historial real de Jason (15–27 sep), y sin historial el motor no tiene metas que sugerir. Solo se carga en una base vacía (una vez); después no hace nada. Sin la variable, el iPhone empieza en blanco.
- Usa el **proyecto de Supabase de desarrollo**, el mismo que el simulador. Para uso personal alcanza; el de producción se crea antes de publicar (CLAUDE.md §3, "Entornos").
- Por qué el simulador muestra "sin registro" en casi todos los grupos: el development build es otra app que Expo Go, con su propia base y su propia cuenta anónima. El historial cargado en Expo Go se quedó ahí.

### Pasos (los corre Jason)
1. En el iPhone: **Ajustes › Privacidad y seguridad › Modo de desarrollador** activado (iOS lo pide para instalar apps firmadas desde Xcode). Se reinicia.
2. En Xcode: **Settings › Accounts**, agrega tu Apple ID (una vez).
3. Conecta el iPhone por cable, desbloquéalo y acepta "Confiar en esta computadora".
4. Desde la raíz `unamas/`:
   ```
   EXPO_PUBLIC_SEED=1 npx expo run:ios --device --configuration Release
   ```
   Elige tu iPhone en la lista. Si falla por la firma ("Signing requires a development team"): `xed ios`, target **unamas › Signing & Capabilities › Team** = tu equipo personal, y vuelve a correr el comando.
5. La primera vez, en el iPhone: **Ajustes › General › VPN y gestión de dispositivos** › tu Apple ID › **Confiar**.

Con un Apple ID gratuito la app vence a los **7 días**: se reinstala con el mismo comando, sin `EXPO_PUBLIC_SEED=1`, y los datos se conservan. Con la cuenta de desarrollador de pago ($99/año) dura un año, y es la que se necesita para TestFlight.

# Errores de la primera prueba en el gym (3 oct 2026)

Decisiones de Claude al arreglarlos, sin aprobación paso a paso:
- **Cronómetro desde EMPEZAR:** la sesión se sigue creando con la primera entrada (no hay sesiones vacías), pero con `started_at` = hora de EMPEZAR. La barra se ve desde EMPEZAR con "‹" para volver; el stop aparece con la primera entrada, porque antes no hay nada que terminar.
- **Ejercicio de otro grupo:** se agregan todos sus grupos a la sesión (sentadilla Smith suma pierna y glúteo). **Cambiado por Jason (3 oct 2026):** al deshacer o borrar una entrada, un grupo que se había agregado así se quita si ya no queda ninguna entrada de la sesión que lo trabaje. Los grupos elegidos en la pantalla 1 nunca se quitan. Para distinguirlos, la sesión guarda sus grupos elegidos en `session.chosen_groups` (solo local, migración v6); una sesión sin ese dato (anterior, o bajada de otro teléfono) los trata a todos como elegidos.
- **Sugerencias:** un ejercicio hecho hoy va al final, no desaparece: puede ser una segunda vez.
- **"Por lado":** sale del nombre y queda como nota chica bajo el peso, porque dice cómo dictarlo ("32,5 a cada lado").
- **Placeholder que se quedaba atrás:** no se pudo reproducir desde aquí. Se aplicó el arreglo para la causa conocida (input controlado a través del store): el input guarda su propio texto y se sincroniza cuando cambia desde afuera. A confirmar en el iPhone.
- **"máquina leg press":** regla en el prompt + red en el Worker (CLAUDE.md §6). Una primera versión de la red, más estricta, habría pasado dos frases del seed de ⚠️ a ❌ (descripciones como "bíceps un brazo sentado…"); la simulación lo detectó antes de gastar, y la red quedó limitada a una sola palabra suelta compartida. Eval: ✅ 28 · ⚠️ 4 · ❌ 0 (37/37), $0.1865.

# Selector de peso (4–5 oct 2026, rama `feat/weight-selector`)

Pantalla 2 de la pantalla por ejercicio (BACKLOG, "Ahora"). El componente está en `src/ui/components/WeightSelector/`. **Todavía no está conectado al flujo**: solo se abre desde la pantalla de desarrollo.

## Diseño
- La referencia es el prototipo plano aprobado, `design/selector.html`. Si el código y el prototipo no coinciden, mandan las constantes del prototipo. Las capturas revisadas están en `design/captures/weight-selector/`.
- **Polea:** el paso entre placas es lo que cabe, entre 26 y 36 pt. Ya no se reserva espacio para el hueco bajo el pasador, porque ese hueco no existe en el diseño plano. Si a 26 pt no caben (con 8 pt de margen abajo), la columna se desplaza como una ventana que sigue al pasador.
- **Barra:** la fila de discos para elegir mide `clamp(64, 18 % del alto del área del selector, 96)`. Los círculos escalan con ella y nunca bajan de 44 pt, el mínimo para tocarlos. Así la barra gana alto en el iPhone SE. El número dentro del círculo se queda en 15 pt, porque "1.25" cabe en 44 pt.

## El número grande (probado por Jason en el iPhone, 5 oct 2026)
- Transición por dígito, como `.contentTransition(.numericText())` de SwiftUI:
  - Cada dígito está en una ventana del alto exacto de la línea, con `overflow: hidden`. Solo se mueven los que cambian, sin fade.
  - El dígito viejo sale el 100 % del alto y el nuevo entra desde el otro borde: hacia arriba si el valor sube, hacia abajo si baja.
  - Dura 260 ms con bezier(.2, .8, .2, 1), sin rebote, con 20 ms de desfase entre dígitos, de derecha a izquierda.
- Los dígitos se alinean por posición: unidades con unidades, décimas con décimas. Así, en 9.5 → 10, el 9 se convierte en 0 y el 1 aparece a la izquierda.
- Una posición que desaparece (las décimas en 9.5 → 10) sale deslizándose en la dirección en que cambió el valor, sin desfase.
- El punto y la unidad no se desplazan en vertical. El ancho y el verde cambian en los mismos 260 ms y con la misma curva.
- Con Reduce Motion, el número cambia directo.
- **Cuándo cambia el número:**
  - **Barra:** al cargar un disco, cambia cuando el disco llega a la barra; al quitarlo, cambia al tocarlo.
  - **Al abrir:** el número ya muestra el valor final desde el primer cuadro.
  - **"↺ sugerido", en las tres pestañas:** el número cambia una sola vez, al valor final, cuando empieza la secuencia. Si se toca la polea o las mancuernas a mitad del recorrido, el número pasa a lo que está seleccionado ahí.
  - **Polea y mancuernas a mano:** cambia con cada placa o mancuerna.
- Se descartaron dos versiones antes de esta: el conteo animado de la primera versión, y una primera transición por dígito con fade y un desplazamiento del 40 %.

## Pantalla de desarrollo
- `app/dev/weight-selector.tsx` existe en desarrollo, o en un build hecho con `EXPO_PUBLIC_DEV_SCREENS=1`. Usa ejercicios reales del seed.
- **En el teléfono:** abre en Safari `unamas:///dev/weight-selector?ex=bar&state=sugerido`. Los valores de `ex` son `bar`, `stack` o `rack`, y los de `state` son `sugerido` o `subido`.
- **Para capturas en el simulador:** `xcrun simctl launch <sim> com.jasoncito.unamas -devScreen bar:subido`. Así se evita el diálogo "¿Abrir en unamas?" que sale con `openurl`.
