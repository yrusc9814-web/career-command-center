# Setup Guide

Career Command Center is **agent-neutral** — it does not require a specific AI agent host. Any agent that can read project files, understand project instructions, edit allowed local files, and run Node.js/npm commands can drive the workflow.

## Prerequisites

### Required

- Git
- Node.js 18+ (for PDF generation, utility scripts, and the test suite)
- npm

### Optional (by capability)

- Playwright Chromium — needed for PDF generation and browser-based tooling (`npx playwright install chromium`). Not required for every feature.
- Go 1.21+ — only for the optional TUI dashboard (`dashboard/`)
- A compatible AI agent — required for the agent-driven workflow, with capabilities as described in [README → Agent / Host Compatibility](../README.md)

## Quick Start (5 steps)

### 1. Clone and install

```bash
git clone https://github.com/yrusc9814-web/career-command-center.git
cd career-command-center
npm install
# Optional, for PDF / browser tooling:
npx playwright install chromium
```

### 2. Configure your profile

Copy from the provided templates (never commit these files — they are gitignored):

```bash
cp config/profile.example.yml config/profile.yml
```

Edit `config/profile.yml` with your personal details: name, email, target roles, narrative, proof points.

### 3. Add your CV

Create `cv.md` in the project root with your full CV in markdown format. This is the source of truth for all evaluations and PDFs.

(Optional) Create `article-digest.md` with proof points from your portfolio projects/articles.

### 4. Configure portals

```bash
cp templates/portals-china.example.yml portals.yml   # China mainland (procurement preset)
# or: cp templates/portals.example.yml portals.yml   # English / overseas
```

Edit `portals.yml`:
- Update `title_filter.positive` with keywords matching your target roles
- Replace the anonymous placeholder companies in `tracked_companies` with your real targets
- Customize `search_queries` for your preferred job boards (replace `{city}` placeholders)

### 5. Open with your Agent

Open this project in your compatible agent — for example OpenAI Codex, Claude Code, Cursor, WorkBuddy, 千问办公, ZCode, DIM, Qoder, or another agent capable of reading project instructions and invoking local tools — and let it read `AGENTS.md` first.

There is no universal launch command across hosts; the repo does not invent CLI commands for unverified hosts. (Claude Code users can run `claude` in this directory and use the `/career-ops` skill.)

Then paste a job offer URL, JD text, or screenshot. Career Command Center will automatically evaluate it, generate a report, create a tailored PDF, and track it.

## Host examples

These are compatibility examples, not a claim that every feature has been fully E2E-tested on every host. Compatibility depends on each host's available file, terminal, browser, and tool capabilities. Unless explicitly marked as verified, inclusion in this list does not mean every feature has completed full E2E validation on that host.

| Host | Status |
|------|--------|
| ZCode | Verified — current active development/usage environment |
| Claude Code | Compatibility entry (`.claude/skills/career-ops/SKILL.md` + `CLAUDE.md`) |
| OpenAI Codex / Cursor / WorkBuddy / 千问办公 / DIM / Qoder | Compatible host examples |

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers (lead discovery) | `/career-ops scan` |
| Browser-assisted collection (optional, needs browser control) | `/career-ops browser-search` |
| Process captured JDs (bookmarklet inbox) | `/career-ops inbox` |
| Process pending URLs | `/career-ops pipeline` |
| Generate a PDF | `/career-ops pdf` |
| Batch evaluate | `/career-ops batch` |
| Check tracker status | `/career-ops tracker` |
| Fill application form | `/career-ops apply` |

## Verify Setup

```bash
node tools/cv-sync-check.mjs      # Check configuration  (or: npm run sync-check)
node tools/verify-pipeline.mjs    # Check pipeline integrity (or: npm run verify)
```

## Build Dashboard (Optional)

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard            # Opens TUI pipeline viewer
```
