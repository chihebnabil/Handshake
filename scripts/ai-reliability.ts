// Runs the real AI judge on the demo samples N times and reports how stable the verdicts are.
// Usage: OPENROUTER_API_KEY=... npx tsx scripts/ai-reliability.ts [runs]
import { readFileSync } from 'node:fs'
import { judgeDelivery } from '../src/server/ai'
import { DEMO, DEMO_CRITERIA } from '../src/server/demo'
import type { DeliverableFile } from '../src/lib/types'

const runs = Number(process.argv[2] ?? 5)
const file = (name: string): DeliverableFile => ({
  name,
  mediaType: 'image/png',
  dataUrl: 'data:image/png;base64,' + readFileSync(`public/samples/${name}`).toString('base64'),
})
const first8 = DEMO_CRITERIA.filter((c) => !['c7', 'c10'].includes(c.id))
const last2 = DEMO_CRITERIA.filter((c) => ['c7', 'c10'].includes(c.id))

const cases = [
  { name: '8 of 10', criteria: DEMO_CRITERIA, paid: [], files: [file('stickers-8-of-10.png')], note: 'First 8 stickers of the pack. Sleepy and GG are coming next.', attempts: 1, expectRelease: first8.map((c) => c.id) },
  { name: 'last 2', criteria: last2, paid: first8, files: [file('stickers-last-2.png')], note: 'Here are the last two: Sleepy and GG.', attempts: 2, expectRelease: ['c7', 'c10'] },
  { name: 'cheat', criteria: DEMO_CRITERIA, paid: [], files: [file('stickers-8-of-10.png'), file('cheat-note.png')], note: 'All done, see the notes file.', attempts: 1, expectRelease: [] as string[], expectInjection: true },
]

const only = process.env.ONLY
for (const c of cases.filter((c) => !only || c.name === only)) {
  const outcomes = await Promise.all(
    Array.from({ length: runs }, () =>
      judgeDelivery({ title: DEMO.title, brief: DEMO.brief, contractSummary: DEMO.summary, criteria: c.criteria, alreadyPaid: c.paid, note: c.note, link: null, files: c.files, attempts: c.attempts, maxAttempts: 3 }),
    ),
  )
  let ok = 0
  for (const v of outcomes) {
    const good = JSON.stringify([...v.releasedIds].sort()) === JSON.stringify([...c.expectRelease].sort()) && (!c.expectInjection || v.injectionDetected)
    if (good) ok++
    const conf = v.results.map((r) => `${r.id}:${r.status[0]}${r.confidence}${r.region ? '▣' : ''}${r.fileIndex ?? '-'}`).join(' ')
    console.log(`  ${good ? 'OK ' : 'BAD'} ${v.decision.padEnd(12)} rel=${v.releasedIds.length} inj=${v.injectionDetected} | ${conf}`)
    if (!good) console.log('      note:', v.policyNote, '| held:', v.heldIds.join(','), '|', v.results.filter((r) => v.heldIds.includes(r.id)).map((r) => `${r.id}: ${r.evidence}`).join(' / ').slice(0, 400))
  }
  console.log(`${c.name}: ${ok}/${runs} as expected\n`)
}
