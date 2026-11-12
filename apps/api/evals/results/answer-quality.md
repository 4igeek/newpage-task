# Answer quality evaluation

24 answerable and 6 unanswerable questions over `sample-docs/` (2026-11-12).
Answers: `claude-opus-5-5` at effort `low`, same retrieval settings and prompt as production. Grader: `claude-opus-5-5`.

## Answerable questions

| Metric | Result |
|---|---|
| Correct (states the expected fact) | 24/24 (100%) |
| Faithful (every claim supported by sources) | 24/24 (100%) |
| Citations point at supporting sources | 24/24 (100%) |
| Citations to non-existent sources | 0 answers |
| Wrongly blocked by the relevance gate | 0 |
| Latency p50 / p95 | 1.3 s / 2.1 s |

## Unanswerable questions (hallucination check)

| Metric | Result |
|---|---|
| Declined correctly | 6/6 |
| …of which blocked by the relevance gate (no model call) | 2 |
| Hallucinated an answer | 0/6 |

| Question | Outcome |
|---|---|
| What is the company pension contribution? | model declined |
| How do I reset my FieldCast password? | model declined |
| What is the capital of France? | blocked by gate |
| Who won the football World Cup in 2022? | blocked by gate |
| What programming language is FieldCast written in? | model declined |
| How many employees work in the London office? | model declined |

## Failures

None.

## Cost of this run

Answering: 33,733 input / 2,505 output tokens. Grading: 45,149 input / 3,061 output tokens. Approximate cost: $0.43.
