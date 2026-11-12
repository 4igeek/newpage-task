# Retrieval evaluation

24 answerable and 6 unanswerable questions over `sample-docs/` (2026-11-12).

## Retrieval quality (k = 6)

| Mode | hit@1 | hit@3 | hit@k | MRR |
|---|---|---|---|---|
| vector | 92% | 100% | 100% | 0.958 |
| keyword | 88% | 100% | 100% | 0.931 |
| hybrid | 92% | 100% | 100% | 0.958 |

## Relevance gate calibration (best vector similarity per question)

| | min | median | max |
|---|---|---|---|
| Answerable | 0.560 | 0.737 | 0.872 |
| Unanswerable | 0.436 | 0.599 | 0.717 |

| Unanswerable question | Best similarity |
|---|---|
| What is the company pension contribution? | 0.590 |
| How do I reset my FieldCast password? | 0.651 |
| What is the capital of France? | 0.436 |
| Who won the football World Cup in 2022? | 0.443 |
| What programming language is FieldCast written in? | 0.717 |
| How many employees work in the London office? | 0.599 |

Gate at 0.5: lets through 24/24 answerable questions and blocks 2/6 unanswerable ones. The rest are left to the prompt's "say you couldn't find it" rule.
