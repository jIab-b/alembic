# Audio nodes

Read [the contract](../docs/frontend-contract.md) and relevant
[audio examples](../tests/mock/audio/); resolve links relative to this skill.

Create an openable `name.audio/` containing `.node.txt`, `exports.txt`,
`playbacks.txt`, sources and audio assets. Follow those formats; the first render
row is the default. Declare top-level playback and its length in seconds.
A requested loop still needs its declared audition length and a working stop/reset.
Do not start sound on load or when the user merely selects a scenario.

Use fal for generated audio when requested/appropriate and authorized. Read the
user's `FAL_KEY` from the environment at runtime; never hard-code, print or log it.
Do not obtain a key or make a paid call to work around missing authorization.
If fal is excluded, use WebAudio synthesis when it fits, identifying it honestly.
No local audio models, downloads or model servers.

Use ffmpeg for file editing, trimming, crossfades, seamless joins and loudness
normalization. Do not assume ffmpeg is on PATH.
Discover it with `command -v`, then inspect configured tool locations and
`ALEMBIC_DEPS` (read-only) for an executable; verify its version before using it.
If a needed tool/key is missing, say exactly what is missing; never silently
degrade or claim generated/edited output without producing it.

Use WebAudio for live/synthesized sound; export the media renderer's supported
play/pause/dispose hooks, following the examples. Recreate one-shot sources on
replay and disconnect/close the context on dispose. Keep the preview minimal.
Normalize file loudness (for example -18 LUFS, true peak <= -1 dBTP); measure the
result. For synthesized loops, measure an offline audition and apply the measured
gain to the live signal too. Avoid clipping and inspect/listen across the seam.
Avoid retaining duplicate uncompressed audition files.

Check through `backend/al embed` without `--open`; capture launch output privately.
Never print launch URLs or tokens. Use real hardware rendering.
Reuse [browser checks](../tests/windows-checks.mjs): audio type, area-only tools,
declared duration, silence while armed, nonzero decoded samples during Play,
timed completion, replay and reset. Inspect a screenshot for a restrained preview.
Verify duration, peak/loudness and seam from decoded samples as well as metadata.
Report untested listening or provider paths plainly.
