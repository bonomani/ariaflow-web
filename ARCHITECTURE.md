# ariaflow-web Architecture

## 1. Short Overview

`ariaflow-web` is the browser UI for `ariaflow`.
It does not own engine truth.
It reads the backend API, renders engine state, and sends user actions back to the engine.

## 2. Canonical Role

The UI should stay orthogonal to the engine:

- the backend owns truth
- the UI owns presentation and interaction
- the browser may store preferences locally
- the UI must not become a second source of truth

## 3. What the UI Is For

Question: how do we expose the backend in the simplest useful way?

The UI should help a human or AI:

- see what the backend is handling
- understand engine status and queue state
- inspect logs and evidence
- change policy or actions only through the backend API

## 4. UI Pages

### Summary / Home

Shows a view of the current engine state at a glance.

- active backend
- running state
- active job
- main warning or error

### Queue

Shows the engine queue being handled now.

- queue items
- progress
- grouping
- per-job state

### Status

Shows engine readiness and health.

- service status
- preflight
- dependency checks

### Settings / Policy

Shows policy defaults and editable behavior settings.

- run policy
- queue policy
- group policy
- job policy

### Logs / Evidence

Shows debugging evidence from the engine.

- action history
- contract trace
- declaration JSON
- raw diagnostics

## 5. UI Layout Rule

The page layout should stay simple and human-readable:

- top: global summary
- middle: work area
- bottom: logs or evidence

This keeps the originating engine object close to its debug signal.

## 6. Backend Selection

The UI may support multiple backend URLs, but only as a browser preference.

- default backend: `http://127.0.0.1:8000`
- selected backend stored in localStorage
- the backend remains the source of truth
- the UI only routes requests to the chosen backend

## 7. UI State Rules

- do not duplicate backend truth in the browser
- do not treat localStorage as canonical state
- do not hide failures behind empty loading states
- show backend-unavailable errors clearly

## 8. UI / Backend Boundary

```text
Backend -> owns queue, session, run, policy, logs
UI -> renders engine state, sends actions, stores preferences
Browser storage -> remembers selected backend and UI preferences only
```

## 9. Practical Questions

- `Summary`: what is happening?
- `Queue`: what is being processed?
- `Status`: can the backend run?
- `Settings`: how should it behave?
- `Logs`: why did it happen?

## 10. Design Rules

- Keep the UI simpler than the backend.
- Avoid duplicate explanations across pages.
- Keep debug near the object it explains when possible.
- Use logs for evidence, not as the primary explanation.
- Keep the selected backend visible.
- Make backend failure states obvious.
- Use the light-blue primary button style only for the active selection.
- Do not add extra active-selection text when the button style already communicates selection.
