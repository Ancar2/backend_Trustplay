# Arquitectura de `api_Trustplay`

Este documento define la arquitectura tecnica del backend, que debe ir en cada carpeta y como escalar a nuevos juegos sin romper la plataforma.

## 1) Principios de arquitectura

- Separacion por capas: `routes -> middleware -> controllers -> services/models`.
- Fuente de verdad: MongoDB para estado de negocio, blockchain para verificacion on-chain.
- Seguridad por defecto: validacion de request, JWT, RBAC, CORS, rate limit y cookies seguras.
- Escalabilidad por dominio: lo global va fuera de juegos; cada juego vive en su propio modulo.

## 2) Arbol de carpetas (resumen real)

```text
api_Trustplay/
├─ index.js
├─ package.json
├─ README.md
├─ ARCHITECTURE.md
├─ config/
│  ├─ db.js
│  └─ env.js
├─ routes/
│  ├─ api.router.js
│  └─ modules/
│     ├─ auth.routes.js
│     ├─ users.routes.js
│     ├─ trustplay.routes.js
│     ├─ legal.routes.js
│     └─ oddswin/
│        ├─ oddswin.routes.js
│        ├─ admin.routes.js
│        └─ config.routes.js
├─ middleware/
│  ├─ jwt.js
│  ├─ authorize.js
│  └─ requestValidation.js
├─ controllers/
│  ├─ register.controller.js
│  ├─ login.controller.js
│  ├─ user.controller.js
│  ├─ trustplay/
│  │  ├─ trustplayInfo.controller.js
│  │  └─ legalAcceptance.controller.js
│  ├─ legal/
│  │  └─ legal.controller.js
│  └─ oddswin/
│     ├─ admin.controller.js
│     ├─ box.controller.js
│     ├─ config.controller.js
│     ├─ exclusiveNft.controller.js
│     ├─ lottery.controller.js
│     ├─ player.controller.js
│     ├─ sponsor.controller.js
│     └─ reconcile.controller.js
├─ services/
│  ├─ blockchain.service.js
│  ├─ legal/
│  │  └─ legal.service.js
│  └─ oddswin/
│     ├─ reconcile.service.js
│     ├─ youtubeLive.service.js
│     └─ exclusiveNft.sync.service.js
├─ models/
│  ├─ user.model.js
│  ├─ trustplay/
│  │  └─ trustplayInfo.model.js
│  ├─ legal/
│  │  ├─ legalDocument.model.js
│  │  ├─ legalDocumentVersion.model.js
│  │  └─ legalAcceptance.model.js
│  ├─ oddswin/
│  │  ├─ lottery.model.js
│  │  ├─ box.model.js
│  │  ├─ globalConfig.model.js
│  │  ├─ exclusiveNFT.model.js
│  │  └─ liveEventCache.model.js
│  └─ system/
│     └─ reconcileState.model.js
├─ utils/
│  ├─ sendEmail.js
│  └─ emailTemplates.js
├─ scripts/
│  ├─ seed-legal-documents.js
│  ├─ cleanup-legacy-trustplay-legal.js
│  ├─ security-baseline-check.js
│  └─ dependency-audit.js
├─ tests/
│  ├─ request-validation.test.js
│  └─ env-validation.test.js
└─ docs/
   ├─ API_ENDPOINTS.md
   └─ ENV_VARIABLES.md
```

## 3) Que va en cada capa

### `config/`

Solo bootstrap tecnico.

- `db.js`: conexion y manejo basico de MongoDB.
- `env.js`: validaciones de configuracion obligatoria y reglas de produccion.

No va logica de negocio aqui.

### `routes/`

Define contratos HTTP y aplica middleware.

- No consulta DB directamente.
- No contiene reglas complejas de negocio.
- Agrupa endpoints por dominio (`auth`, `users`, `legal`, `oddswin`).

### `middleware/`

Reglas transversales de seguridad y saneamiento.

- `jwt.js`: autenticacion y rol admin.
- `authorize.js`: ownership y permisos por recurso/wallet.
- `requestValidation.js`: validacion por endpoint.

### `controllers/`

Orquestacion HTTP.

- Lee `req`, valida flujo, llama servicios/modelos, responde `res`.
- Debe permanecer delgado; si crece, mover logica a `services/`.

### `services/`

Logica reutilizable de dominio e integraciones externas.

- On-chain, reconciliacion, sincronizacion, versionado legal.
- Sin acoplarse a detalles de transporte HTTP.

### `models/`

Persistencia y esquemas de datos.

- Un modelo por agregado principal.
- Indices, defaults y restricciones de datos.

### `utils/`

Ayudantes de soporte (plantillas email, envio correo, etc.).

No se usa para estado de negocio central.

### `scripts/`

Operaciones de mantenimiento y auditoria.

- Seeding legal, limpieza legacy, baseline de seguridad, auditoria de dependencias.

### `tests/`

Tests de regresion y contrato basico de validaciones/config.

## 4) Flujos base

### Flujo de request

```text
Client
  -> route
  -> middleware(s)
  -> controller
  -> service/model
  -> response
```

### Flujo legal versionado

```text
Admin crea version
  -> publica version
  -> usuarios consultan version vigente
  -> usuario acepta
  -> se guarda evidencia (version, sha256, ip, userAgent)
```

## 5) Reglas de organizacion obligatorias

1. Todo lo de Oddswin vive en `controllers/oddswin`, `routes/modules/oddswin`, `models/oddswin`, `services/oddswin`.
2. Lo global (auth, users, legal, trustplay) no se mezcla con carpetas de juego.
3. Cada endpoint de escritura debe tener validacion en `requestValidation.js`.
4. Endpoints sensibles deben pasar por JWT + autorizacion segun aplique.
5. No agregar secretos al repositorio (`.env` nunca se versiona).

## 6) Como agregar un nuevo juego (plantilla)

Para un juego nuevo `jackpot`:

1. Crear:
   - `controllers/jackpot/`
   - `models/jackpot/`
   - `routes/modules/jackpot/`
   - `services/jackpot/`
2. Registrar rutas en `routes/api.router.js` bajo `/api/games/jackpot/*`.
3. Reusar middleware global (`jwt`, `authorize`, `requestValidation`).
4. Documentar endpoints en `docs/API_ENDPOINTS.md`.
5. Agregar tests de validacion para endpoints nuevos.

## 7) Validacion y release

Antes de release:

- `npm run verify:ci`
- `npm run security:baseline`
- `npm run audit:deps`
- Opcional combinado: `npm run verify:full`

Referencias:

- Endpoints: `api_Trustplay/docs/API_ENDPOINTS.md`
- Variables de entorno: `api_Trustplay/docs/ENV_VARIABLES.md`
- Checklist release: `docs/PRODUCTION_RELEASE_CHECKLIST.md`
