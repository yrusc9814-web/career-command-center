# Architecture

## System Overview

```
                    ┌─────────────────────────────────┐
                    │         Claude Code Agent        │
                    │   (reads CLAUDE.md + modes/*.md) │
                    └──────────┬──────────────────────┘
                               │
            ┌──────────────────┼──────────────────────┐
            │                  │                       │
     ┌──────▼──────┐   ┌──────▼──────┐   ┌───────────▼────────┐
     │ Single Eval  │   │ Portal Scan │   │   Batch Process    │
     │ (auto-pipe)  │   │  (scan.md)  │   │   (batch-runner)   │
     └──────┬──────┘   └──────┬──────┘   └───────────┬────────┘
            │                  │                       │
            │           ┌──────▼──────┐          ┌────▼─────┐
            │           │ pipeline.md │          │ N workers│
            │           │ (URL inbox) │          │ (claude -p)
            │           └─────────────┘          └────┬─────┘
            │                                          │
     ┌──────▼──────────────────────────────────────────▼──────┐
     │                    Output Pipeline                      │
     │  ┌──────────┐  ┌────────────┐  ┌───────────────────┐  │
     │  │ Report.md│  │  PDF (HTML  │  │ Tracker TSV       │  │
     │  │ (A-F eval)│  │  → Puppeteer)│  │ (merge-tracker)  │  │
     │  └──────────┘  └────────────┘  └───────────────────┘  │
     └────────────────────────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  data/applications.md │
                    │  (canonical tracker)  │
                    └──────────────────────┘
```

## Evaluation Flow (Single Offer)

1. **Input**: User pastes JD text or URL
2. **Extract**: Playwright/WebFetch extracts JD from URL
3. **Classify**: Detect procurement archetype (1 of 3 types: `execution_procurement` / `sourcing` / `strategic_category`; unknown if evidence insufficient — `tools/lib/taxonomy.mjs`)
4. **Evaluate**: 6 blocks (A-F):
   - A: Role summary (archetype / domain / categories / tags / procurement seniority ladder)
   - B: CV match (gaps graded BLOCKER / HARD_GAP / SOFT_GAP / UNKNOWN + capability coverage)
   - C: Level strategy
   - D: Comp research (WebSearch, Chinese sources)
   - E: CV personalization plan (procurement quantified evidence)
   - F: Interview prep (STAR+R stories from the 18-class Story Bank, questions from `modes/interview-questions.md`)
5. **Score (engine, `tools/lib/`)**:
   - CV Match: `cv_match_score` 0-100 (14 factors, Primary 55 / Secondary 30 / Low 15 — `cv-match.mjs`)
   - Career Score: `career_ops_score` true 0-100 across 10 dimensions (Round 1B affine migration (x-1)*25, 2026-09-03; previously 1.0-5.0) (total weight 100, unknown dims excluded from denominator — `scoring.mjs`)
   - Recommendation: five levels via `computeRecommendation` decision chain (matrix + hard redlines + blockers + gap caps, with `trace[]` — `scoring.mjs`; evidence assembled by `eligibility.mjs`)
6. **Report**: Save as `reports/{num}-{company}-{date}.md`
7. **PDF**: Generate ATS-optimized CV (`tools/generate-pdf.mjs`)
8. **Track**: Write TSV to `batch/tracker-additions/`, auto-merged

> Prompt layer rule: all numeric outputs (cv_match_score / career_ops_score / recommendation) come from the runtime engine; the LLM only explains, never recomputes or overrides.

## Batch Processing

The batch system processes multiple offers in parallel:

```
batch-input.tsv    →  batch-runner.sh  →  N × claude -p workers
(id, url, source)     (orchestrator)       (self-contained prompt)
                           │
                    batch-state.tsv
                    (tracks progress)
```

Each worker is a headless Claude instance (`claude -p`) that receives the full `batch-prompt.md` as context. Workers produce:
- Report .md
- PDF
- Tracker TSV line

The orchestrator manages parallelism, state, retries, and resume.

## Data Flow

```
cv.md                    →  Evaluation context
article-digest.md        →  Proof points for matching
config/profile.yml       →  Candidate identity
portals.yml              →  Scanner configuration
templates/states.yml     →  Canonical status values
templates/cv-template.html → PDF generation template
```

## File Naming Conventions

- Reports: `{###}-{company-slug}-{YYYY-MM-DD}.md` (3-digit zero-padded)
- PDFs: `cv-candidate-{company-slug}-{YYYY-MM-DD}.pdf`
- Tracker TSVs: `batch/tracker-additions/{id}.tsv`

## Pipeline Integrity

Scripts maintain data consistency:

| Script | Purpose |
|--------|---------|
| `tools/merge-tracker.mjs` | Merges batch TSV additions into applications.md |
| `tools/verify-pipeline.mjs` | Health check: statuses, duplicates, links |
| `tools/dedup-tracker.mjs` | Removes duplicate entries by company+role |
| `tools/normalize-statuses.mjs` | Maps status aliases to canonical values |
| `tools/cv-sync-check.mjs` | Validates setup consistency |

## Dashboard TUI

The `dashboard/` directory contains a standalone Go TUI application that visualizes the pipeline:

- Filter tabs: All, Evaluated, Applied, Interview, Top >=4, SKIP
- Sort modes: Score, Date, Company, Status
- Grouped/flat view
- Lazy-loaded report previews
- Inline status picker
