# Product

## Register

product

## Platform

web

## Users

Primary users are enterprise knowledge workers, knowledge-base admins and document editors, and evaluation engineers. They work mainly on desktop, often under SSO, and need to move quickly between permissions, async job status, citation evidence, and evaluation quality.

Knowledge workers come to ask grounded questions and leave only when they can inspect sources. Admins and editors keep knowledge bases, documents, members, and ingestion tasks healthy. Evaluation engineers create datasets, run comparisons, and understand why a quality gate passed or failed. The same product serves all three without turning into a marketing surface or a chat toy.

## Product Purpose

This is the web console for an enterprise RAG system already built as a FastAPI backend: OIDC login, streaming Q&A over tenant-scoped knowledge bases, citation and evidence inspection, knowledge-base lifecycle, document upload/reindex/delete, async job tracking, evaluation datasets and runs, baseline-vs-candidate comparison, quality-gate diagnosis, and user/group permission management.

Success is a closed loop: users get answers, can verify the evidence, and can measure and gate quality before trusting the system in production. The creative north star is **The Evidence Desk** — a trustworthy enterprise knowledge operations desk, not a chatbot playground or a marketing-shaped AI product.

## Positioning

Evidence-first enterprise RAG: every answer is backed by inspectable sources, not vibes.

## Brand Personality

Calm, precise, evidence-led.

The interface should feel like a professional desk for knowledge work: dense where work demands density, quiet where attention should stay on the answer and its proof. Voice is direct and operational — status, ownership, evidence, and next action over hype.

Visual and interaction references that capture the right feel:
- Linear — information density and keyboard-speed interaction
- GitHub — status, permissions, and diff-style change clarity
- Stripe Dashboard — clear hierarchy without decorative clutter
- Notion — restrained editor surfaces
- A traditional newsroom desk — evidence, annotation, and source organization

## Anti-references

- Purple-blue “AI product” gradients
- Neon glow and cyan-on-dark sci-fi chrome
- Decorative glassmorphism
- Full-screen grids of identical rounded cards
- Cards nested inside cards
- Hero metrics and vanity dashboards without operational meaning
- Chatbot-toy aesthetics and mascot-led AI UI
- Over-animation and motion that competes with reading
- Default shadcn/template SaaS sameness with no product voice

## Design Principles

1. **Evidence over eloquence** — Prefer source panels, citation trails, and job facts over polished empty states that hide uncertainty.
2. **Closed quality loop** — Chat, evidence, evaluation, and gates should feel like one system, not four disconnected tools.
3. **Operational density** — Desktop-first density for status, permissions, tasks, and diffs; roomy only where reading answers or long evidence needs it.
4. **Calm authority** — Precision and restraint signal trust; spectacle signals a toy.
5. **Inspectability by default** — If a user cannot see why an answer, permission, job, or gate is true, the UI has failed.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Support reduced motion as a first-class path, not an afterthought. Charts and status colors used in evaluation and jobs must remain readable for common forms of color vision deficiency (shape, label, or pattern in addition to hue). Keyboard access and clear labels matter for admin, evaluation, and chat flows alike.
