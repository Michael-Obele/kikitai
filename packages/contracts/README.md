# @kikitai/contracts

Valibot DTOs shared by the web app and every client: mail categories, message details,
thread narratives, settings, and `importUrl`. One schema change here updates all
packages, which is why this package exists instead of duplicated types.

```sh
bun run build  # tsc
bun run check  # tsc --noEmit
```
