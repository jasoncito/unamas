# Backlog

Una línea por ítem: qué, y por qué. Al terminar uno, se saca de aquí. Solo se trabaja en **Ahora**; lo demás, preguntando a Jason (CLAUDE.md, "Backlog").

## Ahora
_(vacío: el flujo por ejercicio y el historial visible están en la rama `feat/flujo-ejercicio`, por probar en el gym)_

## Pronto
- **Agrupar pierna y pantorrilla** (y revisar los grupos en general) — hoy son grupos separados aunque se entrenan juntos.
- **Más animaciones** — que la app se sienta más viva.
- **Live Activity en la pantalla bloqueada durante la sesión** — ver el cronómetro y la sesión sin abrir la app.
- **Editar o borrar una entrada desde "Hoy" después de los 4,5 s** (si no quedó hecho) — corregir un número sin borrar y volver a dictar.

- **Configurar lint** — el proyecto no tiene. `expo lint` lo instaló solo el 5 oct 2026 (`eslint`, `eslint-config-expo`, `eslint.config.js`, sin commit) y marca 24 problemas, casi todos reglas nuevas de React que confunden los valores de Reanimated con estado. Falta decidir si se queda (y con qué reglas) o se revierte.

## Después
- **Sugerir rutinas** (y una pestaña "lo de antes / rutina sugerida", que depende de eso) — hoy la app solo propone lo de la última vez.
- **Perfil con peso corporal y edad** — no afecta la progresión, porque el "salto absorbible" ya es relativo a lo que cada persona levanta (2 kg es +8 % con 24 kg y +33 % con 6 kg); sirve para estadísticas de fuerza relativa y ejercicios con peso corporal. Ejemplo: a alguien de 40 kg le cuesta mucho más subir 1 kg que a alguien de 90 kg; lo cubre el paso aprendido por ejercicio (1 kg o 0,5 kg si el gimnasio los tiene).
- **Integración con Technogym** — investigar si su API lo permite; ahorraría dictar en sus máquinas.
- **Apple Watch** — anotar y ver el cronómetro desde la muñeca.
- **Pantallas de cuenta (guardar con Apple/email, borrar cuenta), multiidioma, mascota, producción y App Store** — pendientes del MVP, para cuando la app esté probada.
