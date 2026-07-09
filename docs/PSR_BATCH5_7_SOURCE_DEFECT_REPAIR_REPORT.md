# PSR Batch 5 / 7 Source Defect Repair Report

## Scope

This report covers only the flagged missing-option defects in:

- `contents/import-ready/public-service-rules.batch5.cleaned.json`
- `contents/import-ready/public-service-rules.batch7.cleaned.json`

Files inspected:

- `contents/converted/public-service-rules.review.json`
- `contents/2026 PROMOTION (FINANCIAL REGULATIONS, PSR & CURRENT AFFAIRS).txt`

No database write, import, or publish was performed.

---

## Defect Repair Table

| Defective item | Source number | Missing option | Recovered value | Source used | correct_option changed? | Result |
| --- | ---: | --- | --- | --- | --- | --- |
| `public-service-rules.batch5.cleaned.json` item 4 | 84 | `option_c` | `All staff of the Nigerian National Petroleum Corporation (NNPC) Plc.` | Raw source line carried the text under a malformed duplicate `b.` label | No | Recovered confidently |
| `public-service-rules.batch7.cleaned.json` item 16 | 136 | `option_d` | `Chief Confidential Secretaries to Permanent Secretaries, Chief Executives and Directors.` | Editorial distractor added because raw source shows only `a`, `b`, `c`, then moves to question 137 | No | Recovered editorially; flagged for review |
| `public-service-rules.batch7.cleaned.json` item 18 | 138 | `option_d` | `0.9 percent, Quadruple` | Raw source line carried the text under a malformed duplicate `b.` label as the fourth option | No | Recovered confidently |

---

## Source Evidence

### Source number 84

Raw source showed:

- `a. Parastatals of the Government of the Federation.`
- `b. The service of the Federation in any capacity in respect of the Government of the Federation as defined in part 4 Section 318 of 1999 Constitution (as amended).`
- `b. All staff of the Nigerian National Petroleum Corporation (NNPC) Plc.`
- `d. All the Personal Assistants to the Accounting Officers of the Ministries, Departments and Agencies (MDAs).`

Conclusion:

- the third option text exists clearly
- the option label is malformed in the raw source
- it was safely recovered into `option_c`

### Source number 136

Raw source showed:

- `a. Chief Cofidential Secretaries ...`
- `b. Assistant Chief Confidential Secretaries ...`
- `c. Principal Secretaries ...`
- then the source jumps directly to question `137`

Conclusion:

- no fourth option text exists in the raw source
- an editorial distractor was added to satisfy the four-option importer requirement
- `correct_option` remained `C`
- the item remains explicitly flagged for human review before publishing

### Source number 138

Raw source showed:

- `a. 1.5 percent, double`
- `b. 3.5 percent, triple`
- `c. 2.5 percent, triple`
- `b. 0.9 percent, Quadruple`

Conclusion:

- the fourth option text exists clearly
- the option label is malformed in the raw source
- it was safely recovered into `option_d`

---

## Correct Option Handling

- no `correct_option` value was changed
- answer keys were preserved exactly as already stored

---

## Verification Results

### Batch 5

Commands run:

- `npm run content:verify-answer-key -- --cleaned "contents/import-ready/public-service-rules.batch5.cleaned.json" --converted "contents/converted/public-service-rules.review.json"`
- `npm run content:check-import-ready -- --file "contents/import-ready/public-service-rules.batch5.cleaned.json"`

Result:

- answer-key matches: `20/20`
- mismatches: `0`
- missing converted items: `0`
- import-readiness: `DRAFT_IMPORT_CANDIDATE`
- blocking errors: `0`

Meaning:

- Batch 5 is no longer structurally blocked

### Batch 7

Commands run:

- `npm run content:verify-answer-key -- --cleaned "contents/import-ready/public-service-rules.batch7.cleaned.json" --converted "contents/converted/public-service-rules.review.json"`
- `npm run content:check-import-ready -- --file "contents/import-ready/public-service-rules.batch7.cleaned.json"`

Result:

- answer-key matches: `20/20`
- mismatches: `0`
- missing converted items: `0`
- import-readiness: `DRAFT_IMPORT_CANDIDATE`
- blocking errors: `0`

Meaning:

- Batch 7 is no longer structurally blocked
- source number `136` still requires human review because one distractor was editorially supplied

---

## Final Status

- Recovered successfully:
  - Batch 5 item 4 / source `84`
  - Batch 7 item 18 / source `138`
- Recovered editorially:
  - Batch 7 item 16 / source `136`

No import, publish, database change, schema change, or UI change was made in this repair task.
