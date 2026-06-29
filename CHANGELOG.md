# Changelog

All notable changes to callsmith are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- `callsmith init --preset <id>` one-shot intake with 5 presets (india-support, global-support, low-latency-demo, cheap-cascaded, browser-voice).
- `callsmith explain --answers <file>` plain-English stack summary (no files written).
- Write protection: `forge`, `scaffold`, `docs`, `simulate` refuse to overwrite existing files. `--force` overwrites; `--dry-run` previews.
- `--help` / `help` / no-arg now exit 0.
- Pothole mitigation: provider potholes resolved by a native layer (e.g. LiveKit audio normalization) are separated into a "Mitigated by native layer" section, removing audio-contract contradictions.
- `.env.example` now includes dashboard links for every required key.
- Generated scaffold includes a `Makefile` (`make install`, `make test`, `make dev`, `make simulate`).
- `data/presets.json` preset definitions.
- `CONTRIBUTING.md`, `SECURITY.md`, issue/PR templates.
- `simulate` now emits `tool_started`/`tool_finished` in realtime mode (was only in cascaded mode).
- Simulate failure messages now explain the cause and the fix.

### Changed
- Interactive `spec` saves answers directly when `--answers` is passed.
- Interactive `spec` shows option IDs alongside labels.
- README quickstart uses `--out ./voice-agent` and passes `--scaffold` to simulate (the documented happy path is green end-to-end).
- README documents local install honestly (npm name conflict noted).

### Fixed
- Audio-contract contradiction: Exotel+LiveKit+Gemini no longer says both "no transcoding" and "build two resamplers".
- `simulate` exited 1 on the default template because realtime mode did not emit tool events.
- `--help` exited 1 as "unknown command".
- Latent bug in `compile.mjs` where `tool-calling.md` content was passed to `path.join` instead of `write`.

## [1.3.0] - Tier 2

### Added
- Cost estimation, conversation state, error handling context.
- 21 provider packs with verified audio contracts + model names + latency/cost estimates.
- LLM + VAD as first-class pipeline citizens.
- Interruption & turn-taking resolution.
- Latency and cost budget modeling.
- Operational scaffold modules (`observability.py`, `tools.py`, `voice_ux.py`, `safety.py`, `handoff.py`, `local_test.py`, `simulate_call.py`).
- `callsmith simulate` fake call lifecycle.
- `callsmith verify-packs` pack freshness checks.
- Framework-native scaffolds (LiveKit AgentSession + Pipecat PipelineWorker + custom FastAPI webhook).
- Impossibility detection, unknown-provider online resolution.
- Byte-deterministic lock, schema validation gate, 40-fixture grid.
