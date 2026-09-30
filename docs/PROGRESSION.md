# Algoritmo de progresión — especificación (MVP)

Objetivo: que cada ejercicio sugiera una meta **un poco arriba** de lo último que hiciste, basada en evidencia, que se adapte a cada persona y que maneje bien estancamientos, fallos y pausas largas.

Cada regla lleva una etiqueta:
- **[evidencia]**: la respalda una fuente citada al final.
- **[heurística]**: es una decisión de diseño razonable pero sin estudio directo detrás. Es un parámetro que hay que validar con uso real.

---

## 1. Principio de arquitectura: el algoritmo es código, no IA

| Parte | Quién lo hace | Por qué |
|---|---|---|
| Entender "press de hombros 24 4 de 9" → `{ejercicio, peso, series}` | IA (función en Cloudflare) | Lenguaje natural, variaciones de nombres |
| Unificar nombres ("press hombros" = "press de hombro con mancuernas") | IA, recibiendo la lista de ejercicios del usuario | Semántica. Si es ambiguo, pregunta (pantalla 5) |
| **Calcular la próxima meta** | **Código determinista en la app (TypeScript)** | Tiene que ser consistente, testeable y explicable. Misma entrada → misma salida |
| Redactar la frase "Casi: la próxima vamos por 4×11" | IA (o plantillas) | Tono. Recibe el resultado del algoritmo, **no lo decide** |

La IA nunca inventa pesos ni repeticiones. Si la IA y el algoritmo discrepan, manda el algoritmo.

---

## 2. Modelo base: doble progresión

Para cada ejercicio hay un **rango de repeticiones** `[piso, tope]`:

1. Mismo peso, sumas repeticiones sesión a sesión.
2. Cuando **todas** las series llegan al tope → subes al siguiente peso disponible y vuelves al piso.

**Por qué este modelo:**
- Subir repeticiones con el mismo peso y subir peso producen hipertrofia similar en personas entrenadas. Plotkin et al. 2022: 8 semanas, 43 sujetos, rango 8–12. **[evidencia]**
- El crecimiento muscular es similar en un espectro amplio de cargas (≥ ~30 % 1RM) si el esfuerzo es alto. Los rangos moderados son los más eficientes en tiempo y en comodidad (Schoenfeld et al. 2021). **[evidencia]**
- La regla clásica de ACSM (2009): subir 2–10 % de carga cuando haces 1–2 repeticiones por encima del objetivo en **dos sesiones seguidas**, y el % menor para músculos pequeños. **[evidencia]**

---

## 3. Parámetros

### 3.1 Rango de repeticiones por tipo de ejercicio

| Tipo | Ejemplos (de tu historial) | Rango inicial | Etiqueta |
|---|---|---|---|
| `compound_heavy` | Sentadilla Smith, press banca con barra | 6–10 | [heurística] dentro de lo recomendado por ACSM para avanzados (6–12 RM) |
| `compound` (multiarticular) | Press de hombro con mancuernas, press en máquina, jalón, low row | 8–12 | [evidencia] ACSM novato/intermedio: 8–12 |
| `isolation` (monoarticular) | Laterales, extensiones de tríceps, curls, leg extension | 10–15 | [heurística] con base en [evidencia]: cargas más ligeras sirven igual (Schoenfeld 2021), y los saltos de peso chicos son proporcionalmente grandes |
| `calf` | Pantorrilla | 12–20 | [heurística] |

La IA asigna el tipo cuando el ejercicio se crea por primera vez, y el usuario lo puede cambiar.

**Personalización del rango:** si en sus 2 primeras sesiones de un ejercicio el usuario hace repeticiones fuera del rango (por ejemplo, siempre 16), el rango pasa a `[mediana − 2, mediana + 3]`. **[heurística]**

### 3.2 Incremento de peso (el "paso")

- Es el **siguiente peso disponible** para ese equipo, por lado o por mancuerna, tal como lo dice el usuario ("20 kg a cada lado", "mancuernas de 24").
- Valores iniciales: mancuernas 2 kg · discos 2.5 kg por lado (barra Z 1.25) · polea/máquina 2.5 kg · máquinas grandes 5 kg.
- **Se aprende:** si el usuario registra 16 → 17.5, el paso de ese ejercicio pasa a 1.5. **[heurística]**

### 3.3 ¿El salto es absorbible?

Con mancuernas o poleas ligeras, el siguiente peso puede ser un +15–33 %, y ahí la regla de 2–10 % de ACSM no se puede cumplir. Criterio:

> Solo se sube de peso si el **1RM estimado** con el peso nuevo en el **piso** no supera en más de 5 % al 1RM estimado con el peso actual en el **tope**.
> 1RM estimado = Epley: `peso × (1 + reps/30)`.

- Si es absorbible → al llegar al tope en todas las series, sube el peso y vuelve al piso.
- Si no es absorbible → el tope se **extiende +5 reps** (por ejemplo, 10–15 pasa a 10–20) y se sube cuando llegas a ese nuevo tope.

La lógica es que bajar repeticiones "paga" el salto de peso. **[heurística]**, derivada de la regla de ACSM (el % más pequeño para músculos pequeños). Epley se usa solo para comparar, nunca se le muestra al usuario.

### 3.4 Otros parámetros

| Parámetro | Valor | Etiqueta |
|---|---|---|
| Esfuerzo objetivo | Terminar las series a 0–2 reps del fallo | [evidencia] La hipertrofia mejora cuanto más cerca del fallo (Robinson et al. 2023), pero llegar al fallo no es superior a no llegar (Refalo et al. 2023) |
| Estancamiento | 3 exposiciones seguidas del mismo ejercicio sin "subió" | [heurística] |
| Pausa larga (repetir) | > 14 días sin hacer ese ejercicio | [heurística] |
| Pausa muy larga (bajar) | > 28 días → baja un paso | [heurística] |
| Salto máximo de 1RM estimado | +5 % | [heurística] |
| Extensión del rango si el salto no es absorbible | +5 reps | [heurística] |

---

## 4. Algoritmo: próxima meta de un ejercicio

Entrada: historial de ese ejercicio (fecha, peso, reps de cada serie), tipo, paso y fecha de hoy.
Salida: `{peso, reps[], motivo}`.

Las reglas se evalúan **en este orden** y se aplica la primera que coincide:

```
last = última exposición
gap  = días desde last

1. gap > 28                     → peso = last.peso − paso, reps = piso en todas      "baja un paso y reconstruye"
2. gap > 14                     → repetir last                                       "repite lo último"
3. estancado (3 sin subir)      → sesión ligera: mitad de series, mismo peso,
                                  lejos del fallo (2–4 reps en reserva);
                                  si tras eso sigue estancado → sugerir variante     "sesión ligera" / "cambia de variante"
4. tope efectivo = tope, o tope + 5 si el salto no es absorbible (§3.3)
5. min(last.reps) ≥ tope efectivo → peso + paso, reps = piso en todas                 "sube peso y vuelve al piso"
6. min(last.reps) < piso Y la exposición anterior tenía menos peso
                                → volver al peso anterior, meta = lo que hiciste ahí +1,
                                  y activar MODO CONFIRMAR (§6)                         "vuelve al peso anterior"
7. series desiguales            → igualar: todas al máximo que lograste (máx. +2 por serie) "iguala las series"
8. si no                        → +1 rep en cada serie (sin pasar el tope efectivo)    "+1 rep por serie"
```

Notas:
- **Paso 3, estancamiento:** según el consenso Delphi de Bell et al. (2023), una descarga es un periodo de menos volumen y/o esfuerzo para recuperarse. Coleman et al. (2024) encontraron que una semana **sin entrenar nada** no mejoró la hipertrofia y restó algo de fuerza. Por eso en el MVP la descarga es **por ejercicio, reactiva y ligera**, no una semana libre programada. **[evidencia + decisión]**
- **Variantes:** variar ejercicios de forma sistemática puede ayudar, pero rotarlos al azar o con demasiada frecuencia perjudica (Kassiano et al. 2022). Por eso la variante se sugiere **solo tras un estancamiento** y debe trabajar el mismo músculo con otro ángulo o equipo (por ejemplo, laterales en polea ↔ con mancuernas). **[evidencia]**
- **Ejercicio nuevo** (sin historial): no hay meta. Se anota "primera vez, queda como referencia".

---

## 5. Comparación para el resumen ("subió / igual / bajó")

Cada ejercicio se compara con **su propio último registro**, sin importar en qué sesión fue.

```
si peso_hoy > peso_antes Y min(reps_hoy) ≥ piso → subió
si peso_hoy == peso_antes → compara la suma de reps: más = subió, igual = igual, menos = bajó
si no (bajó peso, o subió peso pero quedó bajo el piso) → compara la mejor serie con Epley (±1 %)
sin registro previo → nuevo
```

Validado con tu historial: tríceps en polea (25 kg 3×10 → 30 kg 4×10) sale **subió**, y curl barra Z (11.5 kg 4×11 → 12.5 kg 4×10) sale **subió**.

---

## 6. Personalización: cómo se adapta a cada persona

Sin preguntarle nada al usuario, el algoritmo ajusta estas cosas **por ejercicio**:

| Qué aprende | Señal | Ajuste | Etiqueta |
|---|---|---|---|
| Rango de reps | Sus primeras 2 sesiones fuera del rango | Recentra el rango (§3.1) | [heurística] |
| Paso de peso | Los saltos que realmente registra | Actualiza `paso` | [heurística] |
| **Modo confirmar** | Falló una subida de peso (regla 6) | La próxima subida exige el tope en **2 sesiones seguidas** (regla de ACSM) | [evidencia] ACSM 2009 |
| Progresión rápida | Supera la meta en ≥ 2 reps dos veces seguidas | Permite +2 reps por sesión en vez de +1 | [heurística] |
| Días malos | Una sesión bajó sin cambiar el peso | Repite la meta, no baja. Solo baja si ocurre 2 veces | [heurística] |

**Esfuerzo percibido (RIR):** no se le pide al usuario en el MVP. Las personas se equivocan por ~1 rep al estimar cuánto les falta para el fallo, y la estimación empeora por encima de 12 reps (Halperin et al. 2022). Además, la carga autorregulada y la estandarizada dan ganancias de fuerza similares (Hickmott et al. 2022). Pero si el usuario lo dice espontáneamente ("me sobraron 3", "fácil"), la IA lo extrae y:
- "fácil" o ≥ 3 en reserva estando en el tope → permite saltarse el modo confirmar.
- "al fallo" o "no pude más" en el piso → no sube el peso la próxima vez.

**[evidencia de por qué es opcional; el ajuste es heurística]**

### 6.1 Cómo lo aplica el motor (detalles de implementación)

La tabla de arriba deja detalles abiertos. Así los resuelve `src/domain/engine/`. Todos son **[heurística]** y hay que validarlos con uso real.

Todo se **deriva del historial**: el motor lo recorre de la primera a la última exposición, calcula qué meta tenía cada una en su momento y va ajustando el perfil del ejercicio. No se guarda nada: si cambia el algoritmo, el perfil se recalcula solo.

| Qué | Regla exacta |
|---|---|
| Rango recentrado | Solo con las 2 primeras exposiciones, y solo si **todas** sus series quedan fuera del rango **del mismo lado** (todas arriba del tope o todas bajo el piso). Nuevo rango: `[máx(1, mediana − 2), mediana + 3]`, con la mediana de todas esas series, redondeada. |
| Paso aprendido | Cada vez que el peso sube respecto a la exposición anterior, el paso pasa a ser esa diferencia (el **último** salto registrado). |
| Modo confirmar | Se activa cuando el peso sube y alguna serie queda bajo el piso. Se desactiva con la siguiente subida de peso que sí llega al piso. Mientras está activo, subir de peso exige el tope en las **2 últimas** exposiciones con el mismo peso. Si solo la última llegó, la meta es repetir el tope. |
| Progresión rápida | "Superar la meta en ≥ 2" = mismo peso que la meta y **cada** serie de la meta superada en ≥ 2 reps. Se activa tras 2 exposiciones seguidas así. Se apaga cuando el usuario, con el peso de la meta, no la cumple en alguna serie. Afecta solo a la regla 8 (+2 en vez de +1, sin pasar el tope). |
| Días malos | Si la última exposición **bajó sin cambiar el peso** (según el §5) y la anterior no había bajado también con ese peso, la meta es **repetir la meta que tenía esa exposición**, aunque fuera una subida de peso que no hizo. Si bajó 2 veces seguidas, siguen las reglas normales. Se evalúa después de la regla 3 y antes de la 5. |
| Sesión ligera → variante | Las exposiciones hechas con una meta de "sesión ligera" **no cuentan** para el estancamiento, la comparación ni las reglas 4–8. Después de la sesión ligera viene **un intento normal**. Si ese intento sigue estancado, la meta es "cambia de variante" (se repiten los números de la última exposición normal). Se vuelve a sugerir sesión ligera solo cuando la ventana de estancamiento ya no incluye la anterior. |
| RIR "fácil" | Si la última exposición está en el tope y el usuario dijo "fácil" (o ≥ 3 en reserva), se salta el modo confirmar. |
| RIR "al fallo" | Si la última exposición dice "al fallo" o "no pude más", **no se sube el peso**: si estaba en el tope, se repite. En el piso ya no se subiría de todos modos, así que la regla solo cambia algo en el tope. |

---

## 7. Validación con tu historial real

La implementación de referencia (`progression_sim.py`) aplicada a tus registros, con "hoy" = 29 sep 2026. Implementa las reglas 1–8 del §4 y la comparación del §5. La personalización del §6 (modo confirmar, rango y paso aprendidos, progresión rápida) y la sugerencia de variante tras la sesión ligera quedan para la versión en TypeScript (`src/domain/engine/`, ver §6.1).

| Ejercicio | Rango | Última vez | → Meta | Motivo |
|---|---|---|---|---|
| Press de hombro con mancuernas | 8–12 | 24 kg · 4×8 | 24 kg · 4×9 | +1 rep por serie |
| Laterales de pie con mancuernas | 10–15 | 16 kg · 3×12 · 1×10 | 16 kg · 4×12 | iguala las series |
| Laterales en polea | 10–15 → **10–20** | 7.5 kg · 4×10 | 7.5 kg · 4×11 | +1 rep (el salto a 10 kg es +18 % de 1RM, no absorbible → tope extendido) |
| Laterales con pecho en rodillas | 10–15 | 12 kg · 4×12 | 12 kg · 4×13 | +1 rep (sigue bajo el tope de 15) |
| Tríceps en polea, barra V | 10–15 | 30 kg · 4×10 | 30 kg · 4×11 | +1 rep |
| Curl con barra Z (por lado) | 10–15 | 12.5 kg · 4×10 | 12.5 kg · 4×11 | +1 rep |
| Sentadilla en Smith (por lado) | 6–10 | 30 kg · 4×10 | **32.5 kg · 4×6** | todas en el tope → sube peso |
| Leg extension | 10–15 | 70 kg · 4×10 | 70 kg · 4×11 | +1 rep |
| Pantorrilla de pie | 12–20 | 18 kg · 4×16 | 18 kg · 4×17 | +1 rep |
| Press en máquina Technogym (por lado) | 8–12 | 20 kg · 4×12 | **22.5 kg · 4×8** | todas en el tope → sube peso |

Casos borde probados:

| Caso | Resultado |
|---|---|
| 4 sesiones seguidas en 24 kg · 4×8 | sesión ligera: 24 kg · 2×8 |
| Curl barra Z: de 12.5 kg · 4×15 subió a 13.75 kg e hizo 9,8,8,7 (bajo el piso de 10) | vuelve a 12.5 kg · 4×15 y activa modo confirmar |
| 20 días sin hacerlo | repite lo último |
| 40 días sin hacerlo | baja un paso (24 → 22 kg), 4×8 |
| Laterales en polea en 4×20 | sube a 10 kg · 4×10 |

⚠️ **Corrección a los mockups:** en la pantalla de sesión puse "laterales con pecho en rodillas: sube a 14 kg". Con esta especificación la meta correcta es **12 kg · 4×13**, porque el tope del rango para aislamiento es 15, no 12. Los números del mockup eran ilustrativos.

---

## 8. Fuera del MVP (decidido)

- **Volumen semanal por músculo** (series por semana). Hay una relación dosis-respuesta con la hipertrofia (Schoenfeld et al. 2017; Pelland et al. 2026), pero exige planificar la semana y el MVP progresa ejercicio por ejercicio.
- **Descargas programadas** cada 4–6 semanas. Es lo común en la práctica (Bell et al. 2023), pero en el MVP son reactivas (regla 3).
- **Pedir RIR o RPE en cada serie.** Solo se usa si el usuario lo dice.
- **Mascota.**

---

## 9. Datos que la app debe guardar para que esto funcione

```
exercise   { id, canonical_name, aliases[], muscle_groups[], kind, rep_floor, rep_top, step_kg,
             load_basis: 'per_side' | 'per_dumbbell' | 'total' | 'stack',
             confirm_mode: bool, fast_progress: bool }
session    { id, date, muscle_groups[], started_at, ended_at, avg_bpm? }
entry      { id, session_id, exercise_id, load_kg, reps: int[], raw_text, rir_note?, created_at }
```

`reps` es una lista por serie (por ejemplo `[11,11,11,9]`), no "series × reps", porque las series desiguales son la norma.

---

## Fuentes

- Plotkin D, et al. (2022). *Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations.* PeerJ. https://peerj.com/articles/14142/
- Schoenfeld BJ, Grgic J, Van Every DW, Plotkin DL (2021). *Loading Recommendations for Muscle Strength, Hypertrophy, and Local Endurance: A Re-Examination of the Repetition Continuum.* Sports. https://www.mdpi.com/2075-4663/9/2/32
- ACSM (2009). *Progression Models in Resistance Training for Healthy Adults.* Med Sci Sports Exerc 41(3):687–708. https://pubmed.ncbi.nlm.nih.gov/19204579/
- Refalo MC, et al. (2023). *Influence of Resistance Training Proximity-to-Failure on Skeletal Muscle Hypertrophy: A Systematic Review with Meta-analysis.* Sports Med. https://dro.deakin.edu.au/articles/journal_contribution/Influence_of_Resistance_Training_Proximity-to-Failure_on_Skeletal_Muscle_Hypertrophy_A_Systematic_Review_with_Meta-analysis/22030796
- Robinson ZP, et al. (2023). *Exploring the Dose-Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy.* SportRxiv. https://sportrxiv.org/index.php/server/preprint/view/295
- Bell L, et al. (2023). *Integrating Deloading into Strength and Physique Sports Training Programmes: An International Delphi Consensus Approach.* Sports Med – Open. https://link.springer.com/article/10.1186/s40798-023-00633-0
- Coleman M, et al. (2024). *Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations.* PeerJ. https://peerj.com/articles/16777/
- Kassiano W, et al. (2022). *Does Varying Resistance Exercises Promote Superior Muscle Hypertrophy and Strength Gains? A Systematic Review.* J Strength Cond Res. https://pubmed.ncbi.nlm.nih.gov/35438660/
- Halperin I, et al. (2022). *Accuracy in Predicting Repetitions to Task Failure in Resistance Exercise: A Scoping Review and Exploratory Meta-analysis.* Sports Med. https://pubmed.ncbi.nlm.nih.gov/34542869/
- Hickmott LM, et al. (2022). *The Effect of Load and Volume Autoregulation on Muscular Strength and Hypertrophy: A Systematic Review and Meta-Analysis.* Sports Med – Open. https://link.springer.com/article/10.1186/s40798-021-00404-9
- Zourdos MC, et al. (2016). *Novel Resistance Training–Specific RPE Scale Measuring Repetitions in Reserve.* J Strength Cond Res. https://pubmed.ncbi.nlm.nih.gov/26049792/
- Schoenfeld BJ, Ogborn D, Krieger JW (2017). *Dose-response relationship between weekly resistance training volume and increases in muscle mass.* J Sports Sci. https://pubmed.ncbi.nlm.nih.gov/27433992/
- Pelland JC, et al. (2026). *The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains.* Sports Med. https://link.springer.com/article/10.1007/s40279-025-02344-w
