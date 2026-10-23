# Project reference

- The user's primary reference score is `sheet/Waltz_for_Debby_bars_1-40.musicxml`. Use it for default startup and primary visual / interaction verification in future work. Do not modify the reference score to fit detection or UI changes.
- Smaller generated or example scores may remain as focused regression test fixtures.
- Preserve working MIDI connectivity, source score notation, and the distinction between original-score playback and generated Lead Sheet detection targets.

# Multi-agent workflow

Agent definitions live in `.claude/agents/` (`executor.md`, `reviewer.md`). The main session coordinates; it does not do large edits itself.

1. **Plan**: restate the user's request as acceptance criteria. Ask the user only for decisions that are genuinely theirs.
2. **Execute**: delegate to the `executor` agent with the request, the acceptance criteria and the relevant context (files, earlier findings). It returns a change report.
3. **Review**: delegate to the `reviewer` agent with the same request and criteria plus the executor's report. It returns `APPROVE` or `CHANGES_REQUESTED` with evidence.
4. **Iterate**: on `CHANGES_REQUESTED`, send the findings back to the executor, then review again. Stop after 3 rounds and report the open issues to the user.
5. **Report**: tell the user what changed, the reviewer's verdict and evidence, and anything still unverified (for example real-hardware MIDI or audio quality).

Small, single-line fixes or pure questions can be handled directly without the loop.
