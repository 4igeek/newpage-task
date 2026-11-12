/**
 * Answer-quality evaluation: runs every eval question through the real
 * pipeline (same retrieval settings, prompt and model as production) and has
 * Claude grade each answer against its sources. Costs money; roughly $0.75
 * per run with Claude Opus 5.5 as both answerer and grader.
 *
 *   pnpm eval:answers      (needs ANTHROPIC_API_KEY in .env and Docker)
 *
 * Answerable questions are graded on:
 *   correct   - states the expected fact
 *   faithful  - every factual claim is supported by the sources it was given
 *   citations - its [n] citations point at sources that support the claim
 * Unanswerable questions are graded on whether the answer declines instead
 * of inventing an answer (the core hallucination check).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SourceDto } from '@docchat/shared';
import { z } from 'zod';
import { ClaudeLLMClient, type Effort } from '../src/adapters/claude-llm-client.js';
import { formatSources } from '../src/domain/prompt.js';
import type { TraceStore } from '../src/ports/index.js';
import { AnswerQuestion } from '../src/services/answer-question.js';
import {
  loadEvalSet,
  mapWithConcurrency,
  pct,
  productionRetrieval,
  quiet,
  saveReport,
  startEvalEnvironment,
} from './harness.js';

const MODEL = process.env.LLM_MODEL ?? 'claude-opus-5-5';
const EFFORT = (process.env.LLM_EFFORT ?? 'low') as Effort;
const GRADER_MODEL = process.env.GRADER_MODEL ?? 'claude-opus-5-5';
/** USD per million tokens (input, output) for cost reporting; Claude Opus 5.5 list prices. */
const PRICE_PER_MTOK = { input: 4, output: 20 };
const CONCURRENCY = 4;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (add it to .env).');

const AnswerableGrade = z.object({
  reasoning: z.string().describe('Brief justification, written before the verdicts.'),
  correct: z.boolean().describe('The answer states the expected fact.'),
  faithful: z.boolean().describe('Every factual claim in the answer is supported by the sources.'),
  citations_ok: z
    .boolean()
    .describe('Each [n] citation points at a source that supports the claim it follows.'),
  unsupported_claims: z.array(z.string()).describe('Claims not supported by the sources, if any.'),
});

const UnanswerableGrade = z.object({
  reasoning: z.string().describe('Brief justification, written before the verdicts.'),
  declined: z
    .boolean()
    .describe('The answer clearly says the documents do not contain the answer.'),
  hallucinated: z
    .boolean()
    .describe('The answer presents a specific fact as the answer that the sources do not support.'),
});

type AnswerableGrade = z.infer<typeof AnswerableGrade>;
type UnanswerableGrade = z.infer<typeof UnanswerableGrade>;

/** One question run through the real pipeline. */
interface Run {
  text: string;
  sources: SourceDto[];
  outcome: string;
  totalMs: number;
  invalidCitations: number[];
}
type AnswerableResult = Run & { question: string; expect: string; grade: AnswerableGrade | null };
type UnanswerableResult = Run & { question: string; grade: UnanswerableGrade };

const GRADER_SYSTEM = `You are a strict evaluator of a retrieval-augmented question-answering system.
You receive the user's question, the numbered sources the system retrieved, and the system's answer.
Judge only against the sources: outside knowledge never counts as support, even if it is true.
Be concise in your reasoning.`;

const evalSet = await loadEvalSet();
const env = await startEvalEnvironment();
const grader = new Anthropic({ apiKey, maxRetries: 4 });
const noTraces: TraceStore = {
  record: async () => {},
  recent: async () => [],
  stats: async () => {
    throw new Error('unused');
  },
};
const tokens = { answerIn: 0, answerOut: 0, graderIn: 0, graderOut: 0 };

try {
  const answer = new AnswerQuestion(
    {
      retrieve: env.retrieve(productionRetrieval),
      llm: new ClaudeLLMClient(MODEL, EFFORT, apiKey),
      traces: noTraces,
      logger: quiet,
    },
    { historyTurns: 6, maxTokens: 8000 },
  );

  console.log(
    `Answering and grading ${evalSet.answerable.length + evalSet.unanswerable.length} questions...`,
  );

  const answerable = await mapWithConcurrency(
    evalSet.answerable,
    CONCURRENCY,
    async (q): Promise<AnswerableResult> => {
      const run = await ask(answer, q.question);
      if (run.outcome !== 'answered') {
        return { ...q, ...run, grade: null };
      }
      const grade = await gradeWith(
        AnswerableGrade,
        `<question>${q.question}</question>\n<expected_fact>${q.expect}</expected_fact>\n${formatSources(run.sources.map(toPromptSource))}\n<answer>${run.text}</answer>`,
      );
      return { ...q, ...run, grade };
    },
  );

  const unanswerable = await mapWithConcurrency(
    evalSet.unanswerable,
    CONCURRENCY,
    async (question): Promise<UnanswerableResult> => {
      const run = await ask(answer, question);
      // The relevance gate answered without the model: a guaranteed decline, no grading needed.
      if (run.outcome === 'no_relevant_sources') {
        return {
          question,
          ...run,
          grade: {
            reasoning: 'Blocked by the relevance gate.',
            declined: true,
            hallucinated: false,
          },
        };
      }
      const grade = await gradeWith(
        UnanswerableGrade,
        `<question>${question}</question>\n${formatSources(run.sources.map(toPromptSource))}\n<answer>${run.text}</answer>`,
      );
      return { question, ...run, grade };
    },
  );

  await saveReport('answer-quality', report(answerable, unanswerable), {
    answerable,
    unanswerable,
    tokens,
  });
} finally {
  await env.close();
}

async function ask(answer: AnswerQuestion, question: string): Promise<Run> {
  let text = '';
  let sources: SourceDto[] = [];
  let outcome = 'error';
  let totalMs = 0;
  let invalidCitations: number[] = [];
  for await (const event of answer.execute({ messages: [{ role: 'user', content: question }] })) {
    if (event.type === 'retrieval') sources = event.sources;
    if (event.type === 'delta') text += event.text;
    if (event.type === 'error') outcome = `error: ${event.code}`;
    if (event.type === 'done') {
      ({ outcome, invalidCitations } = event);
      totalMs = event.timings.totalMs;
      tokens.answerIn += event.usage.inputTokens;
      tokens.answerOut += event.usage.outputTokens;
    }
  }
  return { text, sources, outcome, totalMs, invalidCitations };
}

async function gradeWith<T extends z.ZodType>(schema: T, content: string): Promise<z.infer<T>> {
  const response = await grader.messages.parse({
    model: GRADER_MODEL,
    max_tokens: 4000,
    system: GRADER_SYSTEM,
    output_config: { effort: 'medium', format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content }],
  });
  tokens.graderIn += response.usage.input_tokens;
  tokens.graderOut += response.usage.output_tokens;
  if (!response.parsed_output) {
    throw new Error(`Grader returned no parseable output (stop_reason: ${response.stop_reason}).`);
  }
  return response.parsed_output;
}

function toPromptSource(s: SourceDto) {
  return {
    n: s.n,
    filename: s.filename,
    heading: s.heading,
    pageStart: s.pageStart,
    pageEnd: s.pageEnd,
    content: s.content,
  };
}

function report(answerable: AnswerableResult[], unanswerable: UnanswerableResult[]) {
  const a = answerable.length;
  const graded = answerable.filter((r) => r.grade);
  const count = (pred: (g: AnswerableGrade) => boolean) =>
    graded.filter((r) => r.grade && pred(r.grade)).length;
  const u = unanswerable.length;
  const latencies = answerable.map((r) => r.totalMs).sort((x, y) => x - y);
  const cost =
    ((tokens.answerIn + tokens.graderIn) * PRICE_PER_MTOK.input +
      (tokens.answerOut + tokens.graderOut) * PRICE_PER_MTOK.output) /
    1_000_000;

  const failures = [
    ...answerable
      .filter((r) => !r.grade?.correct || !r.grade.faithful || !r.grade.citations_ok)
      .map(
        (r) =>
          `- **${r.question}** (${r.grade ? `correct: ${r.grade.correct}, faithful: ${r.grade.faithful}, citations: ${r.grade.citations_ok}` : `outcome: ${r.outcome}`})\n  - Answer: ${oneLine(r.text)}\n  - Grader: ${r.grade ? oneLine(r.grade.reasoning) : 'not graded'}`,
      ),
    ...unanswerable
      .filter((r) => !r.grade.declined || r.grade.hallucinated)
      .map(
        (r) =>
          `- **${r.question}** (unanswerable; declined: ${r.grade.declined}, hallucinated: ${r.grade.hallucinated})\n  - Answer: ${oneLine(r.text)}\n  - Grader: ${oneLine(r.grade.reasoning)}`,
      ),
  ];

  return [
    '# Answer quality evaluation',
    '',
    `${a} answerable and ${u} unanswerable questions over \`sample-docs/\` (${new Date().toISOString().slice(0, 10)}).`,
    `Answers: \`${MODEL}\` at effort \`${EFFORT}\`, same retrieval settings and prompt as production. Grader: \`${GRADER_MODEL}\`.`,
    '',
    '## Answerable questions',
    '',
    '| Metric | Result |',
    '|---|---|',
    `| Correct (states the expected fact) | ${count((g) => g.correct)}/${a} (${pct(
      count((g) => g.correct),
      a,
    )}) |`,
    `| Faithful (every claim supported by sources) | ${count((g) => g.faithful)}/${a} (${pct(
      count((g) => g.faithful),
      a,
    )}) |`,
    `| Citations point at supporting sources | ${count((g) => g.citations_ok)}/${a} (${pct(
      count((g) => g.citations_ok),
      a,
    )}) |`,
    `| Citations to non-existent sources | ${answerable.filter((r) => r.invalidCitations.length > 0).length} answers |`,
    `| Wrongly blocked by the relevance gate | ${answerable.filter((r) => r.outcome === 'no_relevant_sources').length} |`,
    `| Latency p50 / p95 | ${fmtMs(latencies[Math.floor(a * 0.5)])} / ${fmtMs(latencies[Math.min(a - 1, Math.floor(a * 0.95))])} |`,
    '',
    '## Unanswerable questions (hallucination check)',
    '',
    '| Metric | Result |',
    '|---|---|',
    `| Declined correctly | ${unanswerable.filter((r) => r.grade.declined).length}/${u} |`,
    `| …of which blocked by the relevance gate (no model call) | ${unanswerable.filter((r) => r.outcome === 'no_relevant_sources').length} |`,
    `| Hallucinated an answer | ${unanswerable.filter((r) => r.grade.hallucinated).length}/${u} |`,
    '',
    '| Question | Outcome |',
    '|---|---|',
    ...unanswerable.map(
      (r) =>
        `| ${r.question} | ${r.outcome === 'no_relevant_sources' ? 'blocked by gate' : r.grade.declined ? 'model declined' : '**answered**'} |`,
    ),
    '',
    '## Failures',
    '',
    failures.length ? failures.join('\n') : 'None.',
    '',
    '## Cost of this run',
    '',
    `Answering: ${tokens.answerIn.toLocaleString()} input / ${tokens.answerOut.toLocaleString()} output tokens. ` +
      `Grading: ${tokens.graderIn.toLocaleString()} input / ${tokens.graderOut.toLocaleString()} output tokens. ` +
      `Approximate cost: $${cost.toFixed(2)}.`,
    '',
  ].join('\n');
}

function oneLine(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

function fmtMs(ms: number | undefined) {
  return ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`;
}
