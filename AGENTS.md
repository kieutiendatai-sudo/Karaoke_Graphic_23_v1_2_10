AGENTS.md# Karaoke Graphic 23 - Coding Instructions

## Project constraints

- Target Adobe Premiere Pro 23 only.
- This is a CEP extension. Do not migrate to UXP.
- Preserve the one-line subtitle style.
- Preserve existing SRT timing and frame accuracy.
- Do not introduce scale animation unless explicitly requested.

## Modification rules

- Find the root cause before modifying code.
- Prefer the smallest change that solves the problem.
- Do not refactor unrelated code.
- Do not rename or reformat unrelated files.
- Preserve existing behavior unless explicitly requested.
- Every changed line should relate directly to the task.

## Architecture

- The old Premiere Graphic/Crop/keyframe workflow was removed (last version: commit 5b49fd5).
- Current pipeline: SRT -> word timing (`KGCore.timing`) -> ASS -> FFmpeg/libass -> transparent overlay MOV -> one clip imported into Premiere.
- Keep whole-word instant color change, one-line style, and frame-exact SRT timing.
- Do not remove the 2-pass alpha render (color + matte, `alphamerge`, `unpremultiply`) without evidence.

## Verification

Before completing a change:

1. Review the original request.
2. Review the diff.
3. Run the relevant existing tests.
4. Measure before claiming any speed change.
5. Confirm Premiere 23 compatibility.
6. Report which files changed.
7. Report what was actually verified.
8. Clearly state anything that could not be tested inside real Premiere.

Never claim a runtime speed improvement unless supported by measurement.