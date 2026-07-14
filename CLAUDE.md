# CLAUDE.md

## Design Context

Strategic product design lives in [`PRODUCT.md`](PRODUCT.md). Visual system lives in [`DESIGN.md`](DESIGN.md) (extracted from `frontend/src/styles/tokens.css` + components; sidecar at `.impeccable/design.json`).

- **Register:** product (app UI; design serves the task)
- **Platform:** web
- **North star:** The Evidence Desk — calm, precise, evidence-led enterprise RAG console
- **Positioning:** Evidence-first enterprise RAG; every answer backed by inspectable sources
- **Primary home task:** Chat + evidence, with KB ops and evaluation in the same closed loop
- **Anti-slop:** No purple-blue AI gradients, neon glow, glassmorphism, card-grid theater, vanity metrics, chatbot-toy UI, or default shadcn sameness

When designing or building UI, read PRODUCT.md and DESIGN.md before inventing tokens, components, or layout patterns. After material visual changes, re-run `/impeccable document` to keep DESIGN.md and the sidecar in sync.
