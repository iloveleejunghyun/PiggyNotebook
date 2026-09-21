// Live check of chooseTopic() (services/ai.js) against the real Qianfan API.
//
//   node evals/topic-routing.mjs
//
// Not part of the app bundle. It makes ~13 real API calls (a few cents at most)
// using the key in services/ai.config.js. Re-run it whenever the prompt changes.
// Keep the cases here DIFFERENT from the examples written inside the prompt,
// otherwise the model can pass by copying an example.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ai.js and ai.config.js use ES-module syntax with a .js extension, which Node
// won't load as-is here. Load renamed .mjs copies from a temp folder instead.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-eval-'))
fs.copyFileSync(path.join(root, 'services/ai.config.js'), path.join(tmp, 'ai.config.mjs'))
fs.writeFileSync(
  path.join(tmp, 'ai.mjs'),
  fs.readFileSync(path.join(root, 'services/ai.js'), 'utf8').replace("'./ai.config.js'", "'./ai.config.mjs'")
)

// ai.js calls uni.request (a uni-app global); stand in for it with fetch.
globalThis.uni = {
  request: async ({ url, method, header, data }) => {
    const res = await fetch(url, { method, headers: header, body: JSON.stringify(data) })
    let body = null
    try { body = await res.json() } catch (e) { /* non-JSON error page */ }
    return { statusCode: res.status, data: body }
  }
}
const { chooseTopic } = await import(pathToFileURL(path.join(tmp, 'ai.mjs')).href)

const LEARN = { id: 't1', title: 'Learning Methods' }
const STARTUP = { id: 't2', title: 'Startup Ideas' }
const SLEEP = { id: 't3', title: 'Sleep Management' }
const VOCAB = { id: 't4', title: 'Vocabulary Questions' }
const MISC = { id: 't5', title: 'Misc' }

// expect: decision ('keep'|'move'|'new'; omit to skip), topic (title, for 'move'),
// explicit (defaults to false), titleIncludes.
const CASES = [
  { name: 'keep: related note', text: 'Spaced repetition beats cramming', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'keep' } },
  { name: 'keep: bare term', text: 'Feynman technique', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'keep' } },
  { name: 'keep: vague note leans keep', text: 'hmm', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'keep' } },
  { name: 'move: sleep', text: 'Go to bed before 11pm to fall asleep faster', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'move', topic: 'Sleep Management' } },
  { name: 'move: startup', text: 'Idea: an app that turns voice memos into weekly summaries', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'move', topic: 'Startup Ideas' } },
  { name: 'move: vocabulary', text: 'What does ubiquitous mean?', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'move', topic: 'Vocabulary Questions' } },
  { name: 'new: unrelated to everything', text: 'Book flights to Lisbon for the March conference', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'new' } },
  { name: 'move: current topic is a catch-all', text: 'Bedtime routine: no phone after 10', current: MISC, others: [SLEEP, STARTUP], expect: { decision: 'move', topic: 'Sleep Management' } },
  { name: 'explicit new topic (colon form)', text: 'New topic: reading list — finish Atomic Habits by June', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'new', explicit: true, titleIncludes: 'reading' } },
  { name: 'explicit new topic (sentence form)', text: 'Create a topic called Meal Prep. Batch-cook chili on Sundays', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { decision: 'new', explicit: true, titleIncludes: 'meal prep' } },
  { name: 'NOT explicit: mentions "new topic" in passing', text: 'I should write a new topic outline for my blog post', current: LEARN, others: [STARTUP, SLEEP, VOCAB], expect: { explicit: false } },
  { name: 'no topics at all: model proposes a title', text: "Call the dentist to reschedule Thursday's appointment", current: null, others: [], expect: { decision: 'new' } },
  { name: 'no topics at all + explicit', text: 'new topic health: call the dentist Thursday', current: null, others: [], expect: { decision: 'new', explicit: true, titleIncludes: 'health' } }
]

function check(result, expect) {
  const problems = []
  const lc = s => String(s).toLowerCase()
  if (expect.decision && result.decision !== expect.decision) problems.push(`decision ${result.decision}, wanted ${expect.decision}`)
  if (expect.topic && result.suggestedTitle !== expect.topic) problems.push(`topic "${result.suggestedTitle}", wanted "${expect.topic}"`)
  if (result.explicit !== (expect.explicit === true)) problems.push(`explicit ${result.explicit}, wanted ${expect.explicit === true}`)
  if (expect.titleIncludes && !lc(result.suggestedTitle).includes(expect.titleIncludes)) problems.push(`title lacks "${expect.titleIncludes}"`)
  return problems
}

// ai.js logs every raw reply; keep the report readable.
const realWrite = process.stdout.write.bind(process.stdout)
for (const m of ['log', 'warn', 'error']) console[m] = () => {}

let passed = 0
for (const c of CASES) {
  let line
  try {
    const result = await chooseTopic(c.text, c.current, c.others)
    const problems = check(result, c.expect)
    if (!problems.length) passed++
    line = `${problems.length ? 'FAIL' : 'PASS'}  ${c.name}\n        -> ${result.decision} "${result.suggestedTitle}"${result.explicit ? ' [explicit]' : ''}` +
      (problems.length ? `\n        !! ${problems.join('; ')}` : '')
  } catch (e) {
    line = `FAIL  ${c.name}\n        !! threw: ${e.message}`
  }
  realWrite(line + '\n')
}
realWrite(`\n${passed}/${CASES.length} passed\n`)
process.exit(passed === CASES.length ? 0 : 1)
