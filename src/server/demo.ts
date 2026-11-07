import type { Criterion } from '~/lib/types'

/** The ready-made commission behind "Try the live demo": a pack of 10 stickers at $40 each. */
export const STICKERS = [
  { name: 'Hi', look: 'waving one paw' },
  { name: 'Thanks', look: 'happy closed eyes, paws together' },
  { name: 'LOL', look: 'laughing with tears of joy' },
  { name: 'Love', look: 'heart eyes' },
  { name: 'Sad', look: 'crying, one tear' },
  { name: 'Angry', look: 'frowning, angry eyebrows' },
  { name: 'Sleepy', look: 'eyes closed, with "Zzz"' },
  { name: 'Wow', look: 'surprised, big round eyes, open mouth' },
  { name: 'Cool', look: 'wearing sunglasses' },
  { name: 'GG', look: 'thumbs up' },
] as const

export const DEMO = {
  title: 'Sticker pack: Mochi the cat',
  amountCents: 40000,
  brief: `Hi! Mochi is the cat mascot of my Twitch channel. I need a pack of 10 stickers of Mochi for Discord and Telegram, same cute style for all of them, each with its caption written on it:
${STICKERS.map((s, i) => `${i + 1}. ${s.name}: ${s.look}`).join('\n')}
Budget is $400, so $40 per sticker.`,
  summary:
    'Amira will draw 10 stickers of Mochi the cat, one per expression, each with its caption. Every sticker is worth $40 and is paid the moment the AI judge sees it in a delivery.',
  freelancerName: 'Amira Ben Salah',
  clientName: 'Youssef Trabelsi',
}

export const DEMO_CRITERIA: Criterion[] = STICKERS.map((s, i) => ({
  id: `c${i + 1}`,
  title: `"${s.name}" sticker`,
  description: `A sticker of Mochi ${s.look}, with the caption "${s.name}" written on it.`,
  method: 'visual',
  amountCents: 4000,
  sourceQuote: `${i + 1}. ${s.name}: ${s.look}`,
}))
