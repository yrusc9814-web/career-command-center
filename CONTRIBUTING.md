# Contributing to Career Command Center

Thanks for your interest in contributing! Career Command Center is an agent-neutral project — you can develop it with whichever compatible AI agent host you prefer (the original upstream was built with Claude Code).

## Before Submitting a PR

**Please open an issue first to discuss the change you'd like to make.** This helps us align on direction before you invest time coding.

PRs without a corresponding issue may be closed if they don't align with the project's architecture or goals.

### What makes a good PR
- Fixes a bug listed in Issues
- Addresses a feature request that was discussed and approved
- Includes a clear description of what changed and why
- Follows the existing code style and project philosophy (simple, minimal, quality over quantity)

## Quick Start

1. Open an issue to discuss your idea
2. Fork the repo
3. Create a branch (`git checkout -b feature/my-feature`)
4. Make your changes
5. Test with a fresh clone (see [docs/SETUP.md](docs/SETUP.md))
6. Commit and push
7. Open a Pull Request referencing the issue

## What to Contribute

**Good first contributions:**
- Add companies to `templates/portals.example.yml`
- Translate modes to other languages
- Improve documentation
- Add example CVs for different roles (in `examples/`)
- Report bugs via [Issues](https://github.com/yrusc9814-web/career-command-center/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Web Dashboard features (in `dashboard-web/` — test with `npm test`, which covers the dashboard and analysis-contract suites)
- Dashboard TUI features (in `dashboard/` — the legacy Go TUI implementation)
- New skill modes (in `modes/`)
- Script improvements (`.mjs` utilities)

## Guidelines

- Keep modes language-agnostic when possible (the agent reads whichever language the mode uses)
- Scripts should handle missing files gracefully (check `existsSync` before `readFileSync`)
- Dashboard changes require `go build` — test with real data before submitting
- Don't commit personal data (cv.md, profile.yml, applications.md, reports/)

## Development

```bash
# Scripts + full test suite (includes web dashboard / analysis contract tests)
npm test

# Pipeline health check
node tools/verify-pipeline.mjs     # (or: npm run verify)

# Legacy Go TUI dashboard
cd dashboard && go build -o career-dashboard .
./career-dashboard --path .
```

## Need Help?

- [Open an issue](https://github.com/yrusc9814-web/career-command-center/issues)
- [Read the architecture docs](docs/ARCHITECTURE.md)
- Original upstream built by [santifer](https://santifer.io)
