# Extension local checks

Run from the repository root:

```powershell
node --check extension/core.js
node --check extension/popup.js
node --test extension/tests/core.test.js extension/tests/markup.test.js
```

These tests cover pure state/validation logic and static popup contracts. They do
not prove Gmail, Supabase, signed uploads, OAuth, or a loaded MV3 extension. Those
remain separate controlled acceptance gates.
