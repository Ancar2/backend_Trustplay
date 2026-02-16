# Arquitectura de `api_Trustplay`

Este documento define que debe ir en cada carpeta, como escalar a nuevos juegos y que no mezclar.

## Objetivo

Separar claramente:

- Logica compartida de plataforma (usuarios, auth, legal, seguridad).
- Logica por juego (hoy: Oddswin).

Con esta estructura se puede agregar otro juego sin romper lo existente.

## Arbol del proyecto (resumen)

```text
api_Trustplay/
├─ index.js
├─ package.json
├─ package-lock.json
├─ .env
├─ .gitignore
├─ README.md
├─ ARCHITECTURE.md
├─ AUDIT_READINESS.md
├─ config/
│  ├─ env.js
│  └─ db.js
├─ routes/
│  ├─ api.router.js
│  └─ modules/
│     ├─ auth.routes.js
│     ├─ users.routes.js
│     ├─ trustplay.routes.js
│     └─ oddswin/
│        ├─ oddswin.routes.js
│        ├─ admin.routes.js
│        └─ config.routes.js
├─ controllers/
│  ├─ login.controller.js
│  ├─ register.controller.js
│  ├─ user.controller.js
│  ├─ trustplay/
│  │  └─ trustplayInfo.controller.js
│  └─ oddswin/
│     ├─ admin.controller.js
│     ├─ box.controller.js
│     ├─ config.controller.js
│     ├─ exclusiveNft.controller.js
│     ├─ lottery.controller.js
│     ├─ player.controller.js
│     ├─ reconcile.controller.js
│     └─ sponsor.controller.js
├─ models/
│  ├─ user.model.js
│  ├─ trustplay/
│  │  └─ trustplayInfo.model.js
│  ├─ system/
│  │  └─ reconcileState.model.js
│  └─ oddswin/
│     ├─ box.model.js
│     ├─ exclusiveNFT.model.js
│     ├─ globalConfig.model.js
│     └─ lottery.model.js
├─ middleware/
│  ├─ jwt.js
│  ├─ authorize.js
│  └─ requestValidation.js
├─ services/
│  ├─ blockchain.service.js
│  └─ oddswin/
│     └─ reconcile.service.js
├─ utils/
│  ├─ legalAcceptance.js
│  └─ sendEmail.js
├─ scripts/
│  ├─ dependency-audit.js
│  └─ security-baseline-check.js
├─ tests/
│  └─ request-validation.test.js
└─ docs/
   └─ API_ENDPOINTS.md
```

## Que va en cada carpeta

### `config/`

Solo inicializacion tecnica global.

- `env.js`: validacion de variables de entorno requeridas.
- `db.js`: conexion a MongoDB.

No va logica de negocio aqui.

### `routes/`

Define endpoints y compone modulos.

- `api.router.js`: router raiz de la API.
- `modules/*.routes.js`: rutas por dominio.
- `modules/oddswin/*`: todas las rutas del juego Oddswin.

En rutas solo:

- middleware de seguridad/validacion
- llamada al controller

No hacer consultas a DB ni logica compleja aqui.

### `controllers/`

Orquestan la peticion HTTP.

- Leen `req`
- llaman modelos/servicios
- devuelven `res`

Subcarpetas:

- `controllers/oddswin/`: casos de uso del juego Oddswin.
- `controllers/trustplay/`: contenido institucional/legal de la plataforma.

Regla: controller delgado. Si crece mucho, mover logica a `services/` especificos.

### `models/`

Esquemas y modelos de MongoDB.

- `models/user.model.js`: entidad de usuario global.
- `models/trustplay/*`: datos globales de plataforma.
- `models/oddswin/*`: datos propios del juego Oddswin.
- `models/system/*`: estado tecnico de procesos internos (por ejemplo reconciliacion).

No poner reglas HTTP en modelos.

### `middleware/`

Capas transversales reutilizables.

- `jwt.js`: autenticacion JWT y rol admin.
- `authorize.js`: autorizacion de recurso (self/admin/wallet).
- `requestValidation.js`: validacion de payload por endpoint.

Todo endpoint sensible debe usar middleware adecuado antes del controller.

### `services/`

Integraciones externas o logica de dominio reutilizable no HTTP.

- `blockchain.service.js`: acceso a contratos/RPC (hoy enfocado en Oddswin).
- `services/oddswin/reconcile.service.js`: conciliacion on-chain -> base de datos.

Si se agrega otro juego, crear servicios por juego (`services/<game>/...`).

### `utils/`

Funciones auxiliares puras o de soporte.

- `legalAcceptance.js`
- `sendEmail.js`

No guardar estado ni dependencia de request en utils.


### `tests/`

Pruebas automaticas ejecutables en CI.

- tests de validacion y reglas criticas.
- naming sugerido: `*.test.js`.

### `docs/`

Documentacion tecnica de contrato/API.

- `API_ENDPOINTS.md`: mapa de endpoints activos.

## Reglas de organizacion (obligatorias)

1. Todo lo de smart contracts de Oddswin vive en:
   - `controllers/oddswin/*`
   - `models/oddswin/*`
   - `routes/modules/oddswin/*`
   - `services/` especificos de Oddswin
2. Lo compartido (usuarios, auth, legal) queda fuera de carpetas de juego.
3. No duplicar rutas en archivos sueltos fuera de `routes/modules/*`.
4. Toda ruta de escritura debe tener:
   - autenticacion/autorizacion (si aplica)
   - validacion de payload
5. No subir secretos: `.env` nunca se versiona.

## Como agregar un nuevo juego (plantilla)

Para un juego nuevo, por ejemplo `jackpot`:

1. Crear:
   - `controllers/jackpot/`
   - `models/jackpot/`
   - `routes/modules/jackpot/`
   - `services/jackpot/` (si aplica)
2. Crear rutas `routes/modules/jackpot/*.routes.js`.
3. Montarlas en `routes/api.router.js`:
   - legacy solo si es necesario
   - obligatorio namespace: `/api/games/jackpot/*`
4. Reusar middleware global (`jwt`, `authorize`, `requestValidation`).
5. Documentar endpoints nuevos en `docs/API_ENDPOINTS.md`.
6. Agregar tests y actualizar scripts de verificacion si cambia seguridad base.

## Flujo recomendado por endpoint

`Route -> Middleware(s) -> Controller -> Model/Service -> Response`

Ejemplo real:

`routes/modules/oddswin/oddswin.routes.js`
-> `verifyToken` + `requestValidation` + `authorize`
-> `controllers/oddswin/*.controller.js`
-> `models/oddswin/*.model.js` / `services/blockchain.service.js`
