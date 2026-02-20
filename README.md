# API Trustplay (`api_Trustplay`)

Backend de Trustplay construido con Node.js + Express + MongoDB.

Responsabilidades principales:

- Autenticacion local y social.
- Gestion de usuarios, wallets y referidos.
- Dominio de juego Oddswin (loterias, cajas, recompensas, reconciliacion on-chain).
- Versionado legal auditable (documentos, versiones, aceptaciones).

## Requisitos

- Node.js 20+
- MongoDB accesible
- Archivo `.env` configurado

## Instalacion

```bash
cd api_Trustplay
npm install
```

## Ejecucion

```bash
npm run dev      # desarrollo con watch
npm run start    # modo normal
```

Health check:

- `GET /api/health`

## Scripts utiles

```bash
npm run check              # sintaxis de index.js
npm run test               # tests node:test
npm run verify:ci          # check + test
npm run security:baseline  # baseline de seguridad de config
npm run audit:deps         # npm audit runtime
npm run verify:full        # verify:ci + baseline + audit
npm run seed:legal         # seed de documentos legales
```

## Estructura clave

- `routes/`: contrato HTTP por modulo.
- `middleware/`: JWT, authorize, request validation.
- `controllers/`: orquestacion de request/response.
- `services/`: logica reutilizable (legal, reconciliacion, blockchain).
- `models/`: persistencia MongoDB por dominio.
- `scripts/`: tareas operativas y seguridad.
- `tests/`: validaciones de request y entorno.

Documento detallado: `api_Trustplay/ARCHITECTURE.md`.

## Seguridad y configuracion

- CORS por allowlist (`FRONTEND_URL`, `FRONTEND_URLS`).
- Cookies de auth con politica configurable (`AUTH_COOKIE_*`).
- Rate limiting global y de autenticacion.
- Validacion de entorno en arranque (`config/env.js`).

Variables: `api_Trustplay/docs/ENV_VARIABLES.md`.

## Versionado legal (backend source of truth)

Colecciones:

- `legal_documents`
- `legal_document_versions`
- `legal_acceptances`

Evidencia registrada por aceptacion:

- `userId`, `documentKey`, `versionId`, `sha256`, `acceptedAt`, `ip`, `userAgent`.

## Endpoints

Catalogo completo y actualizado:

- `api_Trustplay/docs/API_ENDPOINTS.md`

## Release recomendado

Antes de desplegar:

```bash
npm run verify:full
```

Checklist operativo:

- `docs/PRODUCTION_RELEASE_CHECKLIST.md`
