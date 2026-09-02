# Taste

## Collaboration & communication

- User files requests as brief, informal, bug-report-style notes referencing UI elements by their visible names ("Choose a model modal", "import project modal"), often bundling two asks in one message; expects targeted fixes without lengthy back-and-forth. Confidence: 0.7

## Frontend & UX preferences

- Changes to UI must match established sibling patterns — reuse existing components/conventions rather than inventing parallel treatments (explicitly asked for the model-picker modal to behave "just like import project modal"). Confidence: 0.85
- Async operations (OAuth sign-in, redirects, network round-trips) must show immediate feedback from the first frame — busy indicators, staged status text ("Redirecting… → Signing you in… → Signed in. Redirecting…"), disabled buttons while in flight — because a silent wait window reads to the user as "it didn't work". Confidence: 0.85
- Values interaction feel and motion polish: requested a loading/sign-in animation so the flow "feels smooth"; subtle entrance animations and a consistent motion grammar are welcome, not scope creep. Confidence: 0.8
- Mirrored/symmetric UI states must behave identically — flagged the docked-right placement showing two icons while docked-left was correct and asked for the right side to be updated "similarly"; asymmetric handling of equivalent states reads as a bug. Confidence: 0.7
- Floating panels must not cover the content they assist; prefers space-reserving layouts where the page shrinks/makes room next to the docked panel ("so that it doesn't block the page view") over pure overlays. Confidence: 0.7
- Features should act on natural-language input directly: a plain request like "update the case study" should auto-select the matching command/skill and apply the change to the data, not fall back to replying in chat; requiring exact /command syntax was treated as a defect. Confidence: 0.8
