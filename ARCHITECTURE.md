# Arquitectura de `api_Trustplay`

Documento tecnico del backend para mantener consistencia de capas, seguridad y despliegue.

## 1) Principios

- Separacion por capas: `routes -> middleware -> controllers -> services/models`.
- MongoDB es la fuente de verdad de negocio; blockchain se usa para verificacion y sincronizacion.
- Seguridad por defecto: validacion de requests, JWT, RBAC, CORS por allowlist, rate limit y cookies seguras.
- Escalabilidad por dominio: lo global en modulos globales; cada juego en su propio modulo.

## 2) Arbol de carpetas (resumen real)

```text
api_Trustplay/
├─ index.js
├─ loadSecrets.js
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
│  ├─ security-baseline-check.js
│  └─ dependency-audit.js
├─ tests/
│  ├─ request-validation.test.js
│  └─ env-validation.test.js
└─ docs/
   ├─ API_ENDPOINTS.md
   └─ ENV_VARIABLES.md
```

## 3) Bootstrap de arranque

El arranque de `index.js` sigue esta secuencia:

1. `loadSecrets()` carga configuracion desde `.env` (local) y/o AWS Secrets Manager (produccion).
2. Se importan modulos que dependen de `process.env`.
3. Se construye Express (`helmet`, `cookie-parser`, CORS dinamico, rate limit, rutas).
4. `validateEnv()` valida variables obligatorias.
5. Conexion a MongoDB.
6. `seedLegalDocuments()` para garantizar base legal inicial.
7. `startOddswinReconcileScheduler()` si esta habilitado por entorno.
8. `app.listen(PORT)`.

Si cualquier paso critico falla, el proceso termina con exit code 1.

## 4) Que vive en cada capa

### `loadSecrets.js`

- Unica responsabilidad: cargar configuracion de entorno.
- Soporta desarrollo local (`.env`) y produccion con AWS Secrets Manager.
- Sin logica de negocio.

### `config/`

- `db.js`: conexion a MongoDB.
- `env.js`: validaciones de entorno.

### `routes/`

- Define contratos HTTP y middleware por endpoint.
- No consulta DB directo.
- No contiene reglas complejas de negocio.

### `middleware/`

- `jwt.js`: autenticacion y rol admin.
- `authorize.js`: ownership/permisos por recurso.
- `requestValidation.js`: validacion de payload y params.

### `controllers/`

- Orquestacion request/response.
- Llaman servicios/modelos y devuelven HTTP status + body.
- Mantener delgados; mover logica reusable a `services`.

### `services/`

- Integraciones externas y reglas de negocio reutilizables.
- Ejemplos: legal versioning, reconciliacion on-chain, sync NFT, YouTube live.

### `models/`

- Esquemas e indices MongoDB.
- Un agregado principal por modelo.

### `utils/`

- Soporte transversal (email, templates).

### `scripts/`

- Tareas operativas (seed, cleanup, auditorias).

### `tests/`

- Pruebas de validacion minima de entorno y request contract.

## 5) Flujos clave

### Flujo request general

```text
Client -> route -> middleware(s) -> controller -> service/model -> response
```

### Flujo legal versionado

```text
Admin crea version -> publica version -> usuario consulta documento vigente
-> usuario acepta -> se registra evidencia (versionId, sha256, ip, userAgent, acceptedAt)
```

### Flujo share room

```text
Admin crea configuracion de sala (slug/titulo/descripcion/imagen/url)
-> usuario/crawler abre /share/:slug o /api/trustplay/share/:slug
-> crawler recibe HTML con OG tags (preview)
-> usuario real recibe redirect 302 al enlace de sala
```

## 6) Reglas obligatorias de organizacion

1. Todo Oddswin vive en `controllers/oddswin`, `routes/modules/oddswin`, `models/oddswin`, `services/oddswin`.
2. Dominios globales (`auth`, `users`, `trustplay`, `legal`) no se mezclan con carpetas de juego.
3. Toda ruta de escritura debe tener validacion en `requestValidation.js`.
4. Endpoints sensibles deben pasar por JWT + autorizacion segun corresponda.
5. No versionar secretos en git.

## 7) Guia de despliegue para share links

Para previews correctos en WhatsApp/Telegram/Discord:

- El request del crawler a `/share/:slug` debe llegar al backend (no al SPA statico).
- Si front y back usan dominios distintos, el edge/proxy (ALB, CloudFront, Cloudflare, Nginx) debe enrutar `/share/*` hacia `api_Trustplay`.
- El backend ya responde OG tags para crawler y redirect inmediato para usuarios normales.

## 8) Como agregar un nuevo juego

Para un juego nuevo `jackpot`:

1. Crear carpetas:
   - `controllers/jackpot/`
   - `models/jackpot/`
   - `routes/modules/jackpot/`
   - `services/jackpot/`
2. Registrar rutas en `routes/api.router.js` bajo `/api/games/jackpot/*`.
3. Reusar middleware global (`jwt`, `authorize`, `requestValidation`).
4. Documentar endpoints en `docs/API_ENDPOINTS.md`.
5. Agregar pruebas minimas de regresion.

## 9) Validacion antes de release

- `npm run verify:ci`
- `npm run security:baseline`
- `npm run audit:deps`
- `npm run verify:full` (recomendado)

Referencias:

- Endpoints: `api_Trustplay/docs/API_ENDPOINTS.md`
- Variables de entorno: `api_Trustplay/docs/ENV_VARIABLES.md`
- Checklist de salida: `docs/PRODUCTION_RELEASE_CHECKLIST.md`
