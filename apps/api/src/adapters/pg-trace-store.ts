import { desc, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { queryTraces } from '../db/schema.js';
import type { QueryTrace, StoredTrace, TraceStore } from '../ports/index.js';

export class PgTraceStore implements TraceStore {
  constructor(private readonly db: Database) {}

  async record(trace: QueryTrace) {
    await this.db.insert(queryTraces).values(trace);
  }

  async recent(limit: number): Promise<StoredTrace[]> {
    const rows = await this.db
      .select()
      .from(queryTraces)
      .orderBy(desc(queryTraces.createdAt))
      .limit(limit);
    return rows;
  }

  async stats(since: Date) {
    const window = gte(queryTraces.createdAt, since);

    const [summary] = await this.db
      .select({
        questions: sql<number>`count(*)::int`,
        answeredWithoutCitations: sql<number>`count(*) filter (where ${queryTraces.outcome} = 'answered' and cardinality(${queryTraces.citations}) = 0)::int`,
        withInvalidCitations: sql<number>`count(*) filter (where cardinality(${queryTraces.invalidCitations}) > 0)::int`,
        p50Total: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${queryTraces.totalMs})`,
        p95Total: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${queryTraces.totalMs})`,
        // percentile_cont skips nulls, so questions that never reached the model don't skew these.
        p50FirstToken: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${queryTraces.firstTokenMs})`,
        p95FirstToken: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${queryTraces.firstTokenMs})`,
        inputTokens: sql<number>`coalesce(sum(${queryTraces.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${queryTraces.outputTokens}), 0)::int`,
        avgTopSimilarity: sql<number | null>`avg(${queryTraces.topSimilarity})`,
      })
      .from(queryTraces)
      .where(window);

    const byOutcome = await this.db
      .select({ outcome: queryTraces.outcome, count: sql<number>`count(*)::int` })
      .from(queryTraces)
      .where(window)
      .groupBy(queryTraces.outcome);

    const num = (v: number | string | null | undefined) =>
      v === null || v === undefined ? null : Number(v);
    return {
      questions: summary?.questions ?? 0,
      outcomes: Object.fromEntries(byOutcome.map((r) => [r.outcome, r.count])),
      answeredWithoutCitations: summary?.answeredWithoutCitations ?? 0,
      withInvalidCitations: summary?.withInvalidCitations ?? 0,
      latencyMs: {
        p50Total: num(summary?.p50Total),
        p95Total: num(summary?.p95Total),
        p50FirstToken: num(summary?.p50FirstToken),
        p95FirstToken: num(summary?.p95FirstToken),
      },
      tokens: { input: summary?.inputTokens ?? 0, output: summary?.outputTokens ?? 0 },
      avgTopSimilarity: num(summary?.avgTopSimilarity),
    };
  }
}
