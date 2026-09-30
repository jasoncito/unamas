"""Reference implementation of the progression spec (docs/PROGRESSION.md), run on Jason's real history.
Deterministic: no LLM. The app should port this to TypeScript."""
from dataclasses import dataclass, field
from datetime import date

# ---- Parameters (see PROGRESSION.md §3) ----
RANGES = {"compound_heavy": (6, 10), "compound": (8, 12), "isolation": (10, 15), "calf": (12, 20)}
MAX_E1RM_JUMP = 0.05          # new (load+step, floor) may exceed current (load, top) e1RM by at most 5 % (heuristic)
EXTEND_REPS = 5               # if the next available weight is > 10 %, allow reps above top up to +5
STALL_EXPOSURES = 3           # no improvement in 3 consecutive exposures -> stall
GAP_REPEAT_DAYS = 14          # heuristic
GAP_REDUCE_DAYS = 28          # heuristic

@dataclass
class Exposure:
    day: date
    load: float               # per side / per dumbbell, as the user states it
    reps: list

@dataclass
class Exercise:
    name: str
    kind: str
    step: float               # smallest available increment for this equipment
    history: list = field(default_factory=list)

def epley(load, reps):        # tie-breaker only
    return load * (1 + reps / 30)

def compare(prev: Exposure, cur: Exposure, lo):
    """subió / igual / bajó for the summary screen."""
    if cur.load > prev.load and min(cur.reps) >= lo:
        return "subió"
    if cur.load == prev.load:
        d = sum(cur.reps) - sum(prev.reps)
        return "subió" if d > 0 else ("igual" if d == 0 else "bajó")
    a = max(epley(cur.load, r) for r in cur.reps); b = max(epley(prev.load, r) for r in prev.reps)
    return "subió" if a > b * 1.01 else ("igual" if a >= b * 0.99 else "bajó")

def stalled(ex: Exercise, lo):
    h = ex.history[-(STALL_EXPOSURES + 1):]
    if len(h) < STALL_EXPOSURES + 1:
        return False
    return all(compare(h[i], h[i + 1], lo) != "subió" for i in range(len(h) - 1))

def next_target(ex: Exercise, today: date):
    lo, hi = RANGES[ex.kind]
    last = ex.history[-1]
    n = len(last.reps)
    gap = (today - last.day).days
    if gap > GAP_REDUCE_DAYS:
        return last.load - ex.step, [lo] * n, f"{gap} días sin hacerlo: baja un paso y reconstruye"
    if gap > GAP_REPEAT_DAYS:
        return last.load, last.reps, f"{gap} días sin hacerlo: repite lo último"
    if stalled(ex, lo):
        return last.load, [max(lo, r - 2) for r in last.reps][: max(2, n // 2)], \
            "estancado 3 veces: sesión ligera (mitad de series, lejos del fallo); si sigue, cambia de variante"
    # Can the reset to the bottom of the range absorb the next available weight?
    absorbable = epley(last.load + ex.step, lo) <= epley(last.load, hi) * (1 + MAX_E1RM_JUMP)
    top = hi if absorbable else hi + EXTEND_REPS
    if min(last.reps) >= top:                              # all sets at top -> add load
        return last.load + ex.step, [lo] * n, f"todas las series en {top}: sube {ex.step:g} kg y vuelve a {lo}"
    if min(last.reps) < lo and len(ex.history) > 1 and ex.history[-2].load < last.load:
        prev = ex.history[-2]                              # failed a load jump -> go back
        return prev.load, [min(top, r + 1) for r in prev.reps], "no llegaste al mínimo tras subir peso: vuelve al peso anterior"
    mx = max(last.reps)
    if len(set(last.reps)) > 1:                            # level uneven sets first
        return last.load, [min(top, mx, r + 2) for r in last.reps], "iguala las series"
    return last.load, [min(top, r + 1) for r in last.reps], "+1 rep por serie"

def fmt(load, reps):
    from collections import Counter
    parts = [f"{c}×{r}" for r, c in sorted(Counter(reps).items(), key=lambda x: -x[0])]
    return f"{load:g} kg · " + " · ".join(parts)

D = date
exs = [
    Exercise("Press de hombro con mancuernas", "compound", 2.0,
             [Exposure(D(2026, 9, 16), 24, [8] * 4), Exposure(D(2026, 9, 27), 24, [8] * 4)]),
    Exercise("Laterales de pie con mancuernas", "isolation", 2.0,
             [Exposure(D(2026, 9, 16), 16, [10] * 4), Exposure(D(2026, 9, 17), 16, [12, 12, 12, 10])]),
    Exercise("Laterales en polea", "isolation", 2.5, [Exposure(D(2026, 9, 27), 7.5, [10] * 4)]),
    Exercise("Laterales con pecho en rodillas", "isolation", 2.0,
             [Exposure(D(2026, 9, 16), 12, [10] * 4), Exposure(D(2026, 9, 27), 12, [12] * 4)]),
    Exercise("Tríceps en polea, barra V (pushdown)", "isolation", 2.5,
             [Exposure(D(2026, 9, 16), 25, [10] * 3), Exposure(D(2026, 9, 27), 30, [10] * 4)]),
    Exercise("Curl con barra Z (por lado)", "isolation", 1.25,
             [Exposure(D(2026, 9, 15), 11.5, [11] * 4), Exposure(D(2026, 9, 17), 12.5, [10] * 4)]),
    Exercise("Sentadilla en Smith (por lado)", "compound_heavy", 2.5, [Exposure(D(2026, 9, 24), 30, [10] * 4)]),
    Exercise("Leg extension", "isolation", 5.0, [Exposure(D(2026, 9, 24), 70, [10] * 4)]),
    Exercise("Pantorrilla de pie con mancuerna", "calf", 2.0, [Exposure(D(2026, 9, 24), 18, [16] * 4)]),
    Exercise("Press en máquina Technogym (por lado)", "compound", 2.5, [Exposure(D(2026, 9, 17), 20, [12] * 4)]),
]
today = D(2026, 9, 29)
print(f"Hoy: {today}\n")
for e in exs:
    lo, hi = RANGES[e.kind]
    l, r, why = next_target(e, today)
    print(f"{e.name:42s} rango {lo}-{hi:<3} última {fmt(e.history[-1].load, e.history[-1].reps):28s} → {fmt(l, r):26s} ({why})")
print("\nSalto absorbible por el reinicio de reps:")
for e in exs:
    lo, hi = RANGES[e.kind]; L = e.history[-1].load
    print(f"  {e.name:42s} {L:g}→{L+e.step:g} kg  e1RM tope {epley(L,hi):.1f} vs nuevo {epley(L+e.step,lo):.1f}  ({(epley(L+e.step,lo)/epley(L,hi)-1)*100:+.1f} %)")
print("\nComparación (resumen):")
e = exs[4]; print(e.name, compare(e.history[0], e.history[1], RANGES[e.kind][0]))
e = exs[5]; print(e.name, compare(e.history[0], e.history[1], RANGES[e.kind][0]))
