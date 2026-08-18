# student-career-ai

One-command installer for [**student-career-ai**](https://github.com/0xSamad/StudentCareerAI) — the AI-powered job search pipeline built on Claude Code.

```bash
npx @0xSamad/StudentCareerAI init
```

This sets up a ready-to-use workspace:

1. Clones student-career-ai at the latest stable release
2. Installs dependencies

Then open your AI coding tool in the folder. **On first launch the agent walks you through setup — your CV, profile and target roles — just by chatting.** Nothing to configure by hand. student-career-ai is AI-agnostic — Claude Code, Gemini, Codex, Qwen, OpenCode, GitHub Copilot CLI, Antigravity CLI, and Grok Build CLI all work.

The installer bootstraps CLI skill entrypoints after clone, so new CLIs (e.g. Grok) work even when `npx` pulled an older release tag.

## Usage

```bash
npx @0xSamad/StudentCareerAI init [folder]   # default folder: ./student-career-ai
```

Prefer the manual route? `git clone` still works exactly as before — see the [setup guide](https://github.com/0xSamad/StudentCareerAI/blob/main/docs/SETUP.md).

## Requirements

- Node.js 18+
- git

## License

MIT © [Santiago Fernández de Valderrama](https://santifer.io)
