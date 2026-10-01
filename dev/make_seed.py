"""Genera seed.json con el historial real de Jason (15–27 sep 2026) para desarrollo y tests."""
import json

# id, nombre canónico (corto, ~28 caracteres; el detalle va en los alias), alias, músculos (claves: shared/muscleGroups.ts), kind, load_basis, step_kg
EX = [
    ("curl_barra_z", "Curl con barra Z", ["bicep curl barra z", "curl barra z"], ["biceps"], "isolation", "per_side", 1.25),
    ("curl_inclinado_mancuernas", "Curl inclinado con mancuernas", ["curl mancuernas banco inclinado"], ["biceps"], "isolation", "per_dumbbell", 2),
    ("curl_martillo_polea", "Curl martillo en polea", ["curl martillo"], ["biceps"], "isolation", "stack", 2.5),
    ("curl_concentracion", "Curl de concentración", ["curl concentrado sentado"], ["biceps"], "isolation", "per_dumbbell", 2),
    ("preacher_curl_z", "Curl predicador con barra Z", ["preacher curl", "banco scott"], ["biceps"], "isolation", "per_side", 1.25),
    ("low_row_maquina", "Remo bajo en máquina", ["low row", "remo bajo", "Remo bajo en máquina (low row)"], ["back"], "compound", "stack", 5),
    ("jalon_pecho_maquina", "Jalón al pecho en máquina", ["jalón al pecho", "lat pulldown"], ["back"], "compound", "stack", 5),
    ("lumbar_maquina", "Extensión lumbar en máquina", ["máquina lumbar", "lumbar technogym"], ["back"], "isolation", "stack", 5),
    ("press_hombro_mancuernas", "Press de hombro con mancuernas", ["press de hombros", "press hombro mancuernas", "press militar mancuernas"], ["shoulders"], "compound", "per_dumbbell", 2),
    ("press_hombro_maquina", "Press de hombro en máquina", ["press hombro technogym", "press militar máquina"], ["shoulders"], "compound", "per_side", 2.5),
    ("laterales_pie_mancuernas", "Laterales de pie", ["laterales de pie", "elevaciones laterales", "Elevaciones laterales de pie con mancuernas"], ["shoulders"], "isolation", "per_dumbbell", 2),
    ("laterales_polea", "Laterales en polea", ["laterales en polea", "Elevaciones laterales en polea"], ["shoulders"], "isolation", "stack", 2.5),
    ("laterales_pecho_rodillas", "Laterales con pecho en rodillas", ["pájaros", "laterales inclinado", "deltoide posterior mancuernas", "Elevaciones laterales con pecho en rodillas"], ["shoulders"], "isolation", "per_dumbbell", 2),
    ("face_pull", "Face pull en polea alta", ["jalón a la cara", "jalones polea deltoide posterior"], ["shoulders"], "isolation", "stack", 2.5),
    ("frontales_mancuernas", "Frontales con mancuernas", ["frontales", "Elevaciones frontales con mancuernas"], ["shoulders"], "isolation", "per_dumbbell", 2),
    ("triceps_polea_tras_cabeza", "Tríceps en polea tras nuca", ["tríceps polea detrás de la cabeza", "overhead polea", "Extensión de tríceps en polea por detrás de la cabeza"], ["triceps"], "isolation", "stack", 2.5),
    ("pushdown_barra_v", "Tríceps en polea, barra V", ["pushdown", "tríceps polea barra v", "tríceps arriba hacia abajo", "Tríceps en polea con barra V (pushdown)"], ["triceps"], "isolation", "stack", 2.5),
    ("triceps_mancuerna_cabeza", "Tríceps sobre la cabeza", ["tríceps sobre la cabeza", "copa con mancuerna", "Extensión de tríceps sobre la cabeza con mancuerna"], ["triceps"], "isolation", "total", 2),
    ("press_banca_barra", "Press de banca con barra", ["press banca", "bench press", "Press de banca plano con barra"], ["chest"], "compound_heavy", "per_side", 2.5),
    ("press_pecho_maquina", "Press de pecho en máquina", ["press pecho technogym"], ["chest"], "compound", "per_side", 2.5),
    ("sentadilla_smith", "Sentadilla en máquina Smith", ["sentadilla smith", "squat smith"], ["legs", "glutes"], "compound_heavy", "per_side", 2.5),
    ("zancadas_barra", "Zancadas alternas con barra", ["lunges", "zancadas en el sitio"], ["legs", "glutes"], "compound", "per_side", 2.5),
    ("leg_extension", "Extensión de pierna", ["leg extension", "Extensión de pierna en máquina"], ["legs"], "isolation", "stack", 5),
    ("pantorrilla_pie_mancuerna", "Pantorrilla de pie", ["pantorrilla de pie", "Elevación de pantorrilla de pie con mancuerna"], ["calves"], "calf", "total", 2),
]
RANGES = {"compound_heavy": (6, 10), "compound": (8, 12), "isolation": (10, 15), "calf": (12, 20)}

# fecha, grupos, duración min, bpm, [(ex_id, carga_kg|None, reps[], texto original resumido)]
SESSIONS = [
    ("2026-09-15", ["biceps", "back"], 61, 118, [
        ("curl_barra_z", 11.5, [11] * 4, "bicep curl con barra z 11.5 kilos a cada lado, 11 repeticiones 4 series"),
        ("curl_inclinado_mancuernas", 14, [8] * 4, "bicep curl mancuernas de 14kg en banco inclinado 4 de 8"),
        ("curl_martillo_polea", None, [10] * 4, "curl martillo en la polea 4 de 10"),
        ("low_row_maquina", 40, [15] * 4, "maquina de espalda low row, 4 de 15, 40 kilos"),
        ("curl_concentracion", 12, [10] * 3, "bíceps un brazo sentado con el codo en la rodilla, 12 kilos, 3 de 10"),
        ("lumbar_maquina", None, [15] * 3, "máquina lumbar technogym número 44, 3 de 15"),
    ]),
    ("2026-09-16", ["shoulders", "triceps"], 62, 116, [
        ("press_hombro_mancuernas", 24, [8] * 4, "press de hombros con mancuernas en banco, 24 kilos por mancuerna, 4 de 8"),
        ("laterales_pie_mancuernas", 16, [10] * 4, "elevaciones laterales de pie con mancuernas, 16 kilos, 4 de 10"),
        ("laterales_pecho_rodillas", 12, [10] * 4, "elevaciones laterales con el pecho topando las rodillas, mancuernas de 12, 4 de 10"),
        ("triceps_polea_tras_cabeza", 25, [10] * 4, "tríceps en polea con barra en v por detrás de la cabeza, 25 kilos, 4 de 10"),
        ("pushdown_barra_v", 25, [10] * 3, "tríceps de arriba hacia abajo, 3 de 10, 25"),
    ]),
    ("2026-09-17", ["chest", "shoulders", "biceps", "back"], None, None, [
        ("press_banca_barra", 20, [12] * 4, "press banca plano con barra 20 kilos a cada lado, 4 de 12"),
        ("laterales_pie_mancuernas", 16, [12, 12, 12, 10], "elevaciones laterales con mancuerna, 16 kilos, 3 de 12 y 1 de 10"),
        ("press_hombro_maquina", 20, [12] * 4, "máquina de hombro, press, 20 kilos a cada lado, 4 de 12"),
        ("face_pull", 25, [12] * 4, "jalones en la polea arriba para hombro posterior, con 25, 4 de 12"),
        ("frontales_mancuernas", 12, [10] * 3, "elevaciones frontales con mancuernas, 12 kilos cada una, 3 de 10"),
        ("press_pecho_maquina", 25, [10] * 3, "máquina de pecho, 25 kilos a cada lado, 3 de 10"),
        ("curl_barra_z", 12.5, [10] * 4, "curl barra z 12,5 kilos por lado 4 de 10"),
        ("curl_inclinado_mancuernas", 14, [10] * 3, "mancuernas bíceps en banca inclinada, 14 kilos por lado 3 de 10"),
        ("curl_martillo_polea", 25, [10] * 4, "curl martillo en poleas 25k 4x10"),
        ("preacher_curl_z", 10, [8] * 4, "preacher con barra z 10 kilos cada lado 4 de 8"),
        ("jalon_pecho_maquina", 40, [12] * 4, "jalón al pecho de espalda en máquina 4 de 12 con 40k"),
        ("low_row_maquina", 45, [12] * 4, "low row en máquina 45k 4 de 12"),
    ]),
    ("2026-09-24", ["legs", "calves"], None, None, [
        ("sentadilla_smith", 30, [10] * 4, "sentadilla en la smith 4 de 10 30 kilos a cada lado"),
        ("zancadas_barra", 10, [16] * 3, "lunges en el mismo sitio alternando, barra 10 kilos a cada lado 3 de 16"),
        ("leg_extension", 70, [10] * 4, "leg extension 70 4 de 10"),
        ("pantorrilla_pie_mancuerna", 18, [16] * 4, "pantorrilla de pie, 18 kilos una mancuerna, 4 de 16"),
    ]),
    ("2026-09-27", ["shoulders", "triceps"], None, None, [
        ("press_hombro_mancuernas", 24, [8] * 4, "press de hombros con mancuernas de 24 4 de 8"),
        ("laterales_polea", 7.5, [10] * 4, "elevaciones laterales de hombros en polea con 7,5. 4 de 10 cada hombro"),
        ("laterales_pecho_rodillas", 12, [12] * 4, "elevaciones laterales con pecho en rodillas, mancuernas de 12k, 4 de 12"),
        ("pushdown_barra_v", 30, [10] * 4, "tríceps en polea alta con barra en v con 30 kilos 4 de 10"),
        ("triceps_mancuerna_cabeza", 20, [10] * 3, "tríceps por encima de la cabeza con una mancuerna de 20, 3 de 10"),
    ]),
]

ids = {e[0] for e in EX}
out = {"exercises": [], "sessions": [], "entries": []}
for i, n, al, mg, k, lb, st in EX:
    lo, hi = RANGES[k]
    out["exercises"].append(dict(id=i, canonical_name=n, aliases=al, muscle_groups=mg, kind=k, rep_floor=lo, rep_top=hi,
                                 step_kg=st, load_basis=lb))
for si, (d, groups, dur, bpm, entries) in enumerate(SESSIONS, 1):
    sid = f"s{si}"
    out["sessions"].append(dict(id=sid, date=d, muscle_groups=groups, duration_min=dur, avg_bpm=bpm))
    for ei, (ex, load, reps, raw) in enumerate(entries, 1):
        assert ex in ids, ex
        out["entries"].append(dict(id=f"{sid}e{ei}", session_id=sid, exercise_id=ex, load_kg=load, reps=reps, raw_text=raw))
json.dump(out, open("seed.json", "w"), ensure_ascii=False, indent=2)
print(len(out["exercises"]), "ejercicios,", len(out["sessions"]), "sesiones,", len(out["entries"]), "registros")
