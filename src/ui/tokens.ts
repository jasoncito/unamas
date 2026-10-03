export const color = {
  green: '#29FF94', // acento: solo relleno o texto sobre oscuro; tinta encima
  bg: '#100E11',
  raised: '#1C1A1D',
  surface: '#2B2B2B',
  border: '#4F4D50',
  divider: '#403E41',
  text: '#FCF9FC',
  muted: '#7E7C7F',
  ink: '#100E11',
} as const;

/** Equipment in the weight selector (design/selector.html): neutral metal for what repeats, green for what goes up. */
export const metal = {
  light: '#D8D5D9',
  dark: '#8F8C90',
  shine: '#F4F2F5',
  dim: '#4A484B',
  dimLight: '#6E6B6F',
  greenDark: '#12B866',
  greenShine: '#9DFFCC',
} as const;

// Fuente del sistema (SF Pro en iOS). tracking en em.
export const type = {
  tally: { size: 34, weight: '800', tracking: -0.025 },
  flood: { size: 46, weight: '800', tracking: -0.03 },
  muscle: { size: 30, weight: '800', tracking: -0.025 },
  title: { size: 20, weight: '700', tracking: -0.01 },
  input: { size: 17, weight: '500' },
  body: { size: 16, weight: '500' },
  row: { size: 15, weight: '400' },
  label: { size: 13, weight: '600' },
  button: { size: 15, weight: '700', uppercase: true, tracking: 0.02 },
} as const;

export const radius = { input: 16, card: 20, bubble: 18, pill: 999 } as const;
export const space = { screenX: 20, rowY: 9 } as const;
