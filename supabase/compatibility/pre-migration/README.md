# Pre-migration payment compatibility deployment

This package preserves the payment behavior currently deployed before the
eight pending migrations. Its only intentional changes are:

- prefer the hosted default publishable and secret key dictionaries;
- retain temporary fallback support for the legacy Supabase keys;
- enforce a valid bearer session inside both candidate functions; and
- disable gateway JWT verification for all three functions while retaining
  Paystack signature verification over the raw webhook body.

Deploy this package only from its own work directory. Do not copy these files
over the post-migration functions in `supabase/functions`.
