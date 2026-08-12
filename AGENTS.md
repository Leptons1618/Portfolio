Before performing any substantial task:

1. Inspect the repository and current state before changing anything.
2. Read the SKILL.md files for all explicitly requested skills.
3. Use the smallest relevant set of skills.
4. Do not invoke unrelated skills merely because they are available.
5. Never guess when repository evidence can be inspected.
6. Clearly distinguish:
   - confirmed facts
   - hypotheses
   - recommendations
   - unknowns
7. Do not modify files during an audit unless explicitly instructed.
8. Do not perform speculative refactoring.
9. Preserve unrelated user changes.
10. Inspect git status before modifying anything.
11. Run appropriate tests/checks after implementation changes.
12. Inspect the resulting diff.
13. Do not introduce dependencies without justification.
14. Do not optimize without evidence.
15. Do not redesign UI before understanding the existing product and workflows.
16. Do not change business behavior during UI implementation unless explicitly required.
17. At the end of every phase report:
    - what was discovered
    - what changed
    - what was verified
    - remaining risks
    - recommended next step

When a task requires a capability not covered by the current skills, use `find-skills` to identify a suitable skill before proposing installation.