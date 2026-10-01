// Every piece of UI text, in Spanish (CLAUDE.md §12).
export const copy = {
  picker: {
    title: '¿Qué toca hoy?',
    subtitle: 'Primero lo que más tiempo lleva sin entrenar. El orden en que tocas es el orden de la sesión.',
    never: 'sin registro',
    other: 'Otro…',
    otherPlaceholder: 'Escribe el grupo',
    start: 'Empezar',
  },
  session: {
    planTitle: 'hoy te toca',
    load: 'Peso',
    sets: 'Series',
    before: 'antes',
    perSide: '(por lado)',
    firstTitle: '¿Con qué empiezas?',
    genericPlaceholder: 'press de hombro, 24 kg, 4 de 8',
    last: 'Última:',
    noLast: 'Sin registro',
    mic: 'Dictar',
    send: 'Enviar',
    nextTitle: '¿Qué sigue?',
    nextPlaceholder: 'Escribe o dicta el siguiente',
    today: 'Hoy',
    vs: 'vs.',
    firstTime: 'primera vez',
    pending: 'pendiente',
    // Screen 5
    otherPlaceholder: 'U otra cosa, dímelo',
    lastLoad: 'última',
    noLastLoad: 'sin registro',
    // Replies that aren't an entry
    unclear: 'No te entendí. Dime el ejercicio, el peso y las series.',
    offline: 'Sin señal: lo guardé y lo anoto cuando vuelva.',
    unclearRetry: (said: string) => `No entendí “${said}”. Dímelo de nuevo.`,
    planTitleStarted: 'Hoy te toca',
    // Screen 6
    holdToEnd: 'Mantén para terminar',
    stopLabel: 'Terminar la sesión',
    stopHint: 'Mantén presionado un segundo y medio',
    ended: 'Sesión terminada',
    // Screen 7
    nextTime: 'La próxima vez',
    close: 'Cerrar',
    // Screen 1: a doubt from a session already stopped
    fromSession: (day: string, groups: string) => `De tu sesión del ${day.toLowerCase()} · ${groups}`,
    notNow: 'Ahora no',
  },
} as const;
