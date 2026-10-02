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
