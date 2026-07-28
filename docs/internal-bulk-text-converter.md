# Internal bulk text converter

This helper is for local content preparation only.

It converts structured bulk objective-question text into PromotionSure upload-ready CSV files. It does not publish questions, import questions, update Supabase, or replace the admin upload validator.

Use it only when preparing legacy bulk text files before uploading through the normal admin import flow.

```bash
npm run internal:convert-bulk-text -- "C:\path\to\questions.txt" --list
```

Convert one section:

```bash
npm run internal:convert-bulk-text -- "C:\path\to\questions.txt" --section "Public Financial Management" --out ".temp\converted"
```

Rules:

- Treat the output as a draft file for admin upload.
- Do not trust converted content without reviewing the generated CSV.
- Do not use it for oral questions unless oral support is deliberately added and tested later.
- Do not add this as a candidate-facing or admin-facing UI without a separate product decision.
- The normal admin upload limit and validation remain the final gate.
