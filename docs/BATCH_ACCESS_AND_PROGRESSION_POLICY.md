# Batch Access And Progression Policy

## Purpose

This document defines the access rules for module batches in FPS Exam Practice.

The backend is the source of truth for:

- who can start a batch
- which batch card state should be shown
- what next action should appear after submission

The frontend should display those states and messages, not invent access rules locally.

## Core Policy

### Free users

1. A free user may start `Batch 1` of exactly one module.
2. The free module is locked only after explicit confirmation of `Start free batch`.
3. Visiting a route or opening a page must not silently lock the free module.
4. A free user may retry the same free `Batch 1` once if the first attempt fails.
5. If the free user passes `Batch 1`, the next action is `unlock_full_access`.
6. If the free user fails the retry, the next action is `unlock_full_access`.
7. A free user cannot start:
   - another module once a free module is selected
   - `Batch 2+`
   - draft, archived, or unpublished batches

### Paid users

1. A paid user may start any published batch in any active module.
2. Paid access is limited by published content only.
3. Progress affects recommendations, not access.
4. A paid user may:
   - retry any published batch
   - jump to any published batch
   - review past attempts
5. A failed earlier batch should generate a retry recommendation, not a hard block.
6. Draft, archived, and unpublished batches must never be startable.

## Batch Card States

Supported states:

- `available`
- `completed_passed`
- `completed_failed`
- `locked_requires_payment`
- `unavailable_not_published`

Reason codes:

- `ok`
- `paid_access`
- `free_batch_available`
- `free_retry_available`
- `free_batch_passed_requires_payment`
- `free_retry_used_requires_payment`
- `free_different_module_requires_payment`
- `free_next_batch_requires_payment`
- `not_published`
- `no_questions`
- `unauthenticated`

## Button Behavior

### Available

- `Start Batch N`
- `Continue Batch N`

### Completed passed

- Paid user:
  - `Review`
  - continue via recommended next batch where published
- Free user:
  - `Unlock full access`

### Completed failed

- Free user:
  - `Retry Batch 1` only while retry is still available
- Paid user:
  - `Retry Batch N`
  - optionally continue to another published batch

### Locked requires payment

- `Unlock full access`

### Unavailable not published

- `Coming soon`

## Result Next Actions

### Free

- pass free batch 1 => `unlock_full_access`
- fail first free attempt => `retry_free_batch`
- fail second free attempt => `unlock_full_access`

### Paid

- passed and a later published batch exists => `next_batch`
- passed and no later published batch exists => `module_complete`
- failed and a later published batch exists => `retry_or_next`
- failed and no later published batch exists => `review_only`

## Backend Responsibility

Backend/RPC functions must decide:

- if a batch is startable
- if a batch is published
- if payment is required
- if a retry is allowed
- which next action applies
- which batch is recommended next

This is currently implemented through:

- `get_batch_access_state(subject_slug, batch_number)`
- `get_module_batch_access(subject_slug?)`
- `start_practice_batch(subject_slug, batch_number?)`
- `get_practice_questions(subject_id, limit?, batch_number?)`
- `submit_attempt(mode, subject_id, answers, batch_number?)`
- `get_attempt_review(attempt_id?)`

## Frontend Responsibility

Frontend should:

- ask backend for batch states
- render friendly labels/messages
- show confirmation before locking a free module
- pass explicit batch numbers when starting, retrying, or continuing practice

Frontend should not:

- decide paid/free access from local heuristics alone
- silently lock a free module
- expose raw RPC/database errors directly to users

## Edge Cases

### No questions published

- state: `unavailable_not_published`
- message: `This batch is not available yet.`

### Draft batch only

- draft questions do not make a batch candidate-visible
- state remains `unavailable_not_published`

### Archived batch only

- archived questions do not make a batch candidate-visible

### Paid user failed previous batch

- retry is recommended
- access to other published batches remains allowed

### Free user trying another module

- state: `locked_requires_payment`
- reason: `free_different_module_requires_payment`

### Free user refreshing before confirming free module

- direct practice load must not lock the module
- backend returns a guarded start-from-dashboard message instead

### Existing users with legacy free state

- existing `selected_for_free_access`, `free_first_attempt_completed`, and `free_retry_consumed` remain authoritative
- no destructive reset should happen automatically

### Gapped published batches

- later published batches may still be accessible to paid users
- recommendation should prefer the next sensible published batch
- missing intermediate batches should not be silently treated as passed

### Undersized hold batch

- an undersized draft or hold batch should not be treated as published access
- if it is published intentionally for development, access can still work, but the product should treat it as a content decision, not an access exception
