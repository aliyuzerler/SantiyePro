# @santiyepro/config

Ortak yapılandırma paketi:

- `tsconfig.node.json` — NestJS/Node hedefli TS ayarları
- `tsconfig.react.json` — Next.js (App Router) hedefli TS ayarları
- `tsconfig.react-native.json` — React Native/Expo hedefli TS ayarları
- `eslint.base.mjs` — ESLint 9 flat config tabanı

Kullanım:

```jsonc
// örnek: apps/api/tsconfig.json
{ "extends": "@santiyepro/config/tsconfig.node.json" }
```

TypeScript `strict: true` ve `noUncheckedIndexedAccess: true` tüm uygulamalarda zorunludur.
