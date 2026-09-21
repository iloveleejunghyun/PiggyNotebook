// Live check of processNote() (services/ai.js): one call must return an optional
// reply AND a summary that includes that reply.
//
//   node evals/process-note.mjs
//
// Real API calls (a handful, a few cents at most).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-eval-'))
fs.copyFileSync(path.join(root, 'services/ai.config.js'), path.join(tmp, 'ai.config.mjs'))
fs.writeFileSync(
  path.join(tmp, 'ai.mjs'),
  fs.readFileSync(path.join(root, 'services/ai.js'), 'utf8').replace("'./ai.config.js'", "'./ai.config.mjs'")
)
globalThis.uni = {
  request: async ({ url, method, header, data }) => {
    const res = await fetch(url, { method, headers: header, body: JSON.stringify(data) })
    let body = null
    try { body = await res.json() } catch (e) { /* non-JSON */ }
    return { statusCode: res.status, data: body }
  }
}
const { processNote } = await import(pathToFileURL(path.join(tmp, 'ai.mjs')).href)

const frag = (id, text, aiAnswer = null) => ({ id, text, aiAnswer })
const CASES = [
  {
    name: 'plain thought: no reply, summary mentions it',
    topic: { title: 'Sleep Management', fragments: [frag('a', 'No screens after 10pm'), frag('b', 'Keep the bedroom cool at night')] },
    newId: 'b',
    expect: { reply: false, summaryIncludes: ['cool'] }
  },
  {
    name: 'word lookup: reply given AND in glossary',
    topic: { title: 'English Study', fragments: [frag('a', 'Read one article per day'), frag('b', 'ubiquitous')] },
    newId: 'b',
    expect: { reply: true, summaryIncludes: ['ubiquitous'] }
  },
  {
    name: 'question: reply given',
    topic: { title: 'Cooking', fragments: [frag('a', 'Batch-cook on Sundays'), frag('b', 'How long can cooked rice stay in the fridge?')] },
    newId: 'b',
    expect: { reply: true }
  },
  {
    name: 'instruction-only note: summary must not invent content',
    topic: { title: 'English Study', fragments: [frag('a', 'Create new topic. English Study')] },
    newId: 'a',
    expect: { reply: false, summaryMaxWords: 60 }
  }
]

const realWrite = process.stdout.write.bind(process.stdout)
for (const m of ['log', 'warn', 'error']) console[m] = () => {}

let passed = 0
for (const c of CASES) {
  const problems = []
  let out = ''
  try {
    const r = await processNote(c.topic, c.newId)
    out = `reply=${JSON.stringify(r.reply)}\n        summary=${JSON.stringify(r.summary).slice(0, 300)}`
    if (c.expect.reply !== undefined && (r.reply !== null) !== c.expect.reply) problems.push(`reply ${r.reply === null ? 'null' : 'given'}, wanted ${c.expect.reply ? 'given' : 'null'}`)
    for (const w of c.expect.summaryIncludes || []) if (!r.summary.toLowerCase().includes(w)) problems.push(`summary lacks "${w}"`)
    if (c.expect.summaryMaxWords && r.summary.split(/\s+/).length > c.expect.summaryMaxWords) problems.push(`summary has ${r.summary.split(/\s+/).length} words (max ${c.expect.summaryMaxWords})`)
  } catch (e) {
    problems.push(`threw: ${e.message}`)
  }
  if (!problems.length) passed++
  realWrite(`${problems.length ? 'FAIL' : 'PASS'}  ${c.name}\n        ${out}${problems.length ? `\n        !! ${problems.join('; ')}` : ''}\n`)
}
realWrite(`\n${passed}/${CASES.length} passed\n`)
process.exit(passed === CASES.length ? 0 : 1)
