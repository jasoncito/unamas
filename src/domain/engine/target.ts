/** Why the engine chose a target. The UI turns it into a phrase; the engine never writes copy. */
export type TargetReason =
  | 'long_gap_step_down' // rule 1: > 28 days, drop one step and rebuild from the floor
  | 'gap_repeat' // rule 2: > 14 days, repeat the last exposure
  | 'stalled_light_session' // rule 3: 3 exposures without "up", half the sets, away from failure
  | 'stalled_try_variant' // rule 3: still stalled after the light session and one normal attempt
  | 'bad_day_repeat' // §6: dropped once at the same load, repeat the previous target
  | 'confirm_top' // §6 confirm mode: hit the top once, needs a second time before adding load
  | 'add_load' // rule 5: every set at the effective top
  | 'failed_load_jump' // rule 6: below the floor right after a load increase
  | 'even_out_sets' // rule 7: uneven sets, bring them up to the best one
  | 'add_rep'; // rule 8: +1 rep per set (+2 with fast progress)

export interface Target {
  loadKg: number;
  reps: number[];
  reason: TargetReason;
  /** Days since the last exposure. */
  gapDays: number;
  /** Top of the range used for this decision: repTop, or repTop + EXTEND_REPS if the next load is not absorbable. */
  effectiveTop: number;
}
