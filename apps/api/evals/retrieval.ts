/**
 * Retrieval evaluation. No LLM involved, so it is free, fast and deterministic.
 *
 *   pnpm eval:retrieval
 *
 * For each retrieval mode, reports:
 *   - hit@1 / hit@3 / hit@k: share of questions with a correct chunk in the top N
 *   - MRR: mean reciprocal rank of the first correct chunk
 * It also reports the best vector similarity for answerable vs unanswerable
 * questions, which is how RETRIEVAL_MIN_SIMILARITY was calibrated.
 */
import type { RetrievalMode } from '../src/services/retrieve.js';
import {
  loadEvalSet,
  pct,
  productionRetrieval,
  saveReport,
  startEvalEnvironment,
} from './harness.js';

const evalSet = await loadEvalSet();
const env = await startEvalEnvironment();

try {
  const { topK, minSimilarity: gate } = productionRetrieval;
  // Gate disabled here: we want the raw rankings, and to measure similarities.
  const retrieve = env.retrieve({ ...productionRetrieval, minSimilarity: 0 });
  const n = evalSet.answerable.length;
  const lines: string[] = [
    '# Retrieval evaluation',
    '',
    `${n} answerable and ${evalSet.unanswerable.length} unanswerable questions over \`sample-docs/\` (${new Date().toISOString().slice(0, 10)}).`,
    '',
    `## Retrieval quality (k = ${topK})`,
    '',
    '| Mode | hit@1 | hit@3 | hit@k | MRR |',
    '|---|---|---|---|---|',
  ];

  const misses: string[] = [];
  for (const mode of ['vector', 'keyword', 'hybrid'] as RetrievalMode[]) {
    const ranks = await Promise.all(
      evalSet.answerable.map(async (q) => {
        const { chunks } = await retrieve.execute(q.question, {}, mode);
        const index = chunks.findIndex(
          (c) =>
            c.filename === q.document && c.content.toLowerCase().includes(q.expect.toLowerCase()),
        );
        if (index === -1 && mode === 'hybrid') misses.push(q.question);
        return index === -1 ? null : index + 1;
      }),
    );
    const hitAt = (k: number) => pct(ranks.filter((r) => r !== null && r <= k).length, n);
    const mrr = ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / n;
    lines.push(`| ${mode} | ${hitAt(1)} | ${hitAt(3)} | ${hitAt(topK)} | ${mrr.toFixed(3)} |`);
  }
  if (misses.length) lines.push('', 'Hybrid misses:', ...misses.map((m) => `- ${m}`));

  const best = async (q: string) =>
    (await retrieve.execute(q, {}, 'hybrid')).stats.topSimilarity ?? 0;
  const answerable = await Promise.all(evalSet.answerable.map((q) => best(q.question)));
  const unanswerable = await Promise.all(evalSet.unanswerable.map(best));
  const passed = answerable.filter((s) => s >= gate).length;
  const blocked = unanswerable.filter((s) => s < gate).length;

  lines.push(
    '',
    '## Relevance gate calibration (best vector similarity per question)',
    '',
    '| | min | median | max |',
    '|---|---|---|---|',
    `| Answerable | ${fmt(Math.min(...answerable))} | ${fmt(median(answerable))} | ${fmt(Math.max(...answerable))} |`,
    `| Unanswerable | ${fmt(Math.min(...unanswerable))} | ${fmt(median(unanswerable))} | ${fmt(Math.max(...unanswerable))} |`,
    '',
    '| Unanswerable question | Best similarity |',
    '|---|---|',
    ...evalSet.unanswerable.map((q, i) => `| ${q} | ${fmt(unanswerable[i] ?? 0)} |`),
    '',
    `Gate at ${gate}: lets through ${passed}/${answerable.length} answerable questions and blocks ${blocked}/${unanswerable.length} unanswerable ones. The rest are left to the prompt's "say you couldn't find it" rule.`,
    '',
  );

  await saveReport('retrieval', lines.join('\n'));
} finally {
  await env.close();
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function fmt(n: number) {
  return n.toFixed(3);
}
