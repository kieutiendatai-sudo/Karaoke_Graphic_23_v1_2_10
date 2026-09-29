AGENTS.md# Karaoke Graphic 23 - Coding Instructions

## Project constraints

- Target Adobe Premiere Pro 23 only.
- This is a CEP extension. Do not migrate to UXP.
- Preserve the current one-line subtitle workflow.
- Preserve the current visible karaoke/highlight result.
- Preserve existing SRT timing and frame accuracy.
- Do not introduce scale animation unless explicitly requested.

## Modification rules

- Find the root cause before modifying code.
- Prefer the smallest change that solves the problem.
- Do not refactor unrelated code.
- Do not rename or reformat unrelated files.
- Preserve existing behavior unless explicitly requested.
- Every changed line should relate directly to the task.

## Performance work

Before optimizing, identify the actual bottleneck.

Pay particular attention to:

- CEP -> ExtendScript RPC count
- Premiere API calls inside loops
- per-cue Graphic/property lookups
- timeline scans
- Crop/property collection access
- keyframe writes
- repeated start/end/time reads
- serialization/parsing overhead
- work performed once per cue that could be cached or batched

Do not assume JavaScript computation is the bottleneck if Premiere API calls dominate.

Preserve correctness before reducing API calls.

## Existing optimization

Do not remove existing optimizations without evidence.

The project already uses:
- fast timeline inspection
- cached timing/layout/keyframe plans
- host-side run state
- batched plan submission
- resume tokens/cursors
- reduced repeated keyframe reads
- existing benchmark and tests

## Verification

Before completing a change:

1. Review the original request.
2. Review the diff.
3. Run the relevant existing tests.
4. Run benchmark checks when performance code changes.
5. Confirm Premiere 23 compatibility.
6. Report which files changed.
7. Report what was actually verified.
8. Clearly state anything that could not be tested inside real Premiere.

Never claim a runtime speed improvement unless supported by measurement.