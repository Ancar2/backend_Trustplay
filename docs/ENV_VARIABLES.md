# Variables de entorno de `api_Trustplay`

Este documento explica para que sirve cada variable del `.env`, si es obligatoria y donde se usa.

## Variables obligatorias

Estas variables son obligatorias para que la API arranque:

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `PORT` | Puerto en el que levanta el servidor HTTP. | `3000` | `config/env.js`, `index.js` |
| `DB_URL` | Cadena de conexion a MongoDB. | `mongodb://127.0.0.1:27017/trustplay` | `config/env.js`, `config/db.js` |
| `SECRET_JWT_KEY` | Clave para firmar y validar tokens JWT. | `cambia_esta_clave_por_una_segura` | `config/env.js`, `middleware/jwt.js`, `controllers/login.controller.js`, `controllers/user.controller.js` |

## Variables de aplicacion y sesion

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `NODE_ENV` | Define entorno (`development` o `production`). Afecta banderas de seguridad de cookies. | `development` | `controllers/login.controller.js` |
| `FRONTEND_URL` | Dominio permitido del frontend para CORS y enlaces de correo. | `http://localhost:4200` | `index.js`, `controllers/register.controller.js`, `controllers/user.controller.js` |
| `TOKEN_EXPIRE` | Tiempo de expiracion del JWT. | `24h` | `controllers/login.controller.js`, `controllers/user.controller.js` |
| `EXPOSE_TOKEN_IN_BODY` | Si vale `false`, evita enviar el token en el body de respuesta del login social. | `false` | `controllers/login.controller.js` |

## Variables de seguridad y limites

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `RATE_LIMIT_MAX` | Maximo de peticiones por IP en la ventana global (15 min). | `2000` | `index.js` |
| `AUTH_RATE_LIMIT_MAX` | Maximo de intentos en rutas de autenticacion (15 min). | `50` | `routes/modules/auth.routes.js` |

## Variables de correo

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `SMTP_EMAIL` | Usuario/correo del servicio SMTP. | `tu_correo@dominio.com` | `utils/sendEmail.js` |
| `SMTP_PASSWORD` | Clave o token de aplicacion SMTP. | `tu_password_o_app_password` | `utils/sendEmail.js` |
| `FROM_NAME` | Nombre visible del remitente en correos. | `Trustplay Support` | `utils/sendEmail.js` |
| `EMAIL_LOGO_URL` | URL absoluta del logo que se incrusta en correos de verificacion y recuperacion. Si no se define, usa `FRONTEND_URL/assets/brand/logo-trustplay.png`. | `https://app.trustplay.com/assets/brand/logo-trustplay.png` | `utils/emailTemplates.js` |
| `EMAIL_VERIFY_TTL_MINUTES` | Minutos de vigencia del token de verificacion de correo. | `1440` | `controllers/register.controller.js` |

## Variables de autenticacion social

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Identificador de cliente OAuth de Google para validar token social. | `xxxxxxxxxx.apps.googleusercontent.com` | `controllers/login.controller.js` |
| `INSTAGRAM_CLIENT_ID` | Identificador de cliente OAuth de Instagram. | `1234567890` | `controllers/login.controller.js` |
| `INSTAGRAM_CLIENT_SECRET` | Secreto de cliente OAuth de Instagram. | `secreto_instagram` | `controllers/login.controller.js` |
| `INSTAGRAM_REDIRECT_URI` | URL de retorno registrada en Instagram OAuth. | `http://localhost:4200/auth/instagram/callback` | `controllers/login.controller.js` |

## Variables de blockchain

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `RPC_URL_AMOY` | Endpoint RPC para leer eventos y datos on-chain. | `https://rpc-amoy.polygon.technology/` | `services/blockchain.service.js` |
| `CID_EXCLUSIVE_NFT_METADATA` | CID de respaldo para metadata de NFT exclusivo cuando `tokenURI` no responde o no tiene ruta valida. | `bafybeid3gf5lzb4upo6cpb7hftv7ifganjhtwr7phivtnrfekt7brema2q` | `controllers/oddswin/exclusiveNft.controller.js` |

## Variables para live de YouTube (Lotería de Medellín)

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `YOUTUBE_API_KEY` | API key de YouTube Data API v3 para consultar live/upcoming del canal oficial. | `AIzaSy...` | `services/oddswin/youtubeLive.service.js` |
| `YOUTUBE_LOTERIA_MEDELLIN_CHANNEL_ID` | ID del canal oficial de YouTube que se consulta para detectar el próximo sorteo. | `UCxxxxxxxxxxxxxxxxxxxxxx` | `services/oddswin/youtubeLive.service.js` |
| `YOUTUBE_LIVE_CACHE_TTL_SECONDS` | Tiempo de cache (en segundos) para no consumir cuota en cada request. Recomendado: 300 a 600. | `600` | `services/oddswin/youtubeLive.service.js` |

## Variables de reconciliacion blockchain -> base de datos

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `RECONCILE_AUTO_ENABLED` | Habilita reconciliacion automatica al arrancar (`true`/`false`). | `false` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_INTERVAL_MINUTES` | Frecuencia de ejecucion automatica en minutos. | `15` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_CONFIRMATIONS` | Bloques de confirmacion antes de considerar un evento. | `6` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_MAX_RANGE` | Maximo de bloques procesados por corrida. | `5000` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_LOCK_MINUTES` | Tiempo de bloqueo para evitar corridas simultaneas. | `10` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_START_BLOCK` | Bloque inicial para primera sincronizacion si no hay estado previo. | `0` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_YEAR_START` | Año inicial por defecto para descubrir loterias en Factory cuando se sincroniza blockchain -> DB. Se puede sobrescribir por solicitud desde frontend (`yearStart`). | `2021` | `services/oddswin/reconcile.service.js`, `controllers/oddswin/reconcile.controller.js` |
| `RECONCILE_YEAR_END` | Año final por defecto para descubrir loterias en Factory (incluyente). Se puede sobrescribir por solicitud desde frontend (`yearEnd`). | `2027` | `services/oddswin/reconcile.service.js`, `controllers/oddswin/reconcile.controller.js` |
| `RECONCILE_FACTORY_ADDRESS` | Sobrescribe la direccion Factory usada por reconciliacion (si no se define usa config/valor por defecto). | `0xeC0c...` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_RPC_TIMEOUT_MS` | Tiempo maximo por llamada RPC durante reconciliacion. Si se supera, falla la corrida para evitar procesos colgados. | `20000` | `services/oddswin/reconcile.service.js` |
| `RECONCILE_CREATION_SCAN_START_BLOCK` | Bloque inicial para buscar eventos de creacion de loterias en Factory. Ayuda a reducir tiempo de escaneo. | `0` | `services/oddswin/reconcile.service.js` |

## Variable de ejecucion en integracion continua

| Variable | Para que sirve | Ejemplo | Donde se usa |
|---|---|---|---|
| `CI` | Indica ejecucion en pipeline. Ajusta comportamiento del script de auditoria de dependencias. | `true` | `scripts/dependency-audit.js` |

## Ejemplo de `.env`

```dotenv
PORT=3000
DB_URL=mongodb://127.0.0.1:27017/trustplay
SECRET_JWT_KEY=cambia_esta_clave_por_una_segura

NODE_ENV=development
FRONTEND_URL=http://localhost:4200
TOKEN_EXPIRE=24h
EXPOSE_TOKEN_IN_BODY=false

RATE_LIMIT_MAX=2000
AUTH_RATE_LIMIT_MAX=50

SMTP_EMAIL=tu_correo@dominio.com
SMTP_PASSWORD=tu_password_o_app_password
FROM_NAME=Trustplay Support
EMAIL_LOGO_URL=https://app.trustplay.com/assets/brand/logo-trustplay.png
EMAIL_VERIFY_TTL_MINUTES=1440

GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
INSTAGRAM_CLIENT_ID=1234567890
INSTAGRAM_CLIENT_SECRET=secreto_instagram
INSTAGRAM_REDIRECT_URI=http://localhost:4200/auth/instagram/callback

RPC_URL_AMOY=https://rpc-amoy.polygon.technology/
CID_EXCLUSIVE_NFT_METADATA=bafybeid3gf5lzb4upo6cpb7hftv7ifganjhtwr7phivtnrfekt7brema2q
YOUTUBE_API_KEY=AIzaSy...
YOUTUBE_LOTERIA_MEDELLIN_CHANNEL_ID=UCxxxxxxxxxxxxxxxxxxxxxx
YOUTUBE_LIVE_CACHE_TTL_SECONDS=600

RECONCILE_AUTO_ENABLED=true
RECONCILE_INTERVAL_MINUTES=15
RECONCILE_CONFIRMATIONS=6
RECONCILE_MAX_RANGE=5000
RECONCILE_LOCK_MINUTES=5
RECONCILE_START_BLOCK=0
RECONCILE_YEAR_START=2023
RECONCILE_YEAR_END=9999
RECONCILE_RPC_TIMEOUT_MS=3000
RECONCILE_CREATION_SCAN_START_BLOCK=0
```

## Recomendaciones

- Nunca subir `.env` al repositorio.
- Usar valores diferentes por entorno (`development`, `staging`, `production`).
- Rotar `SECRET_JWT_KEY`, credenciales SMTP y secretos OAuth de forma periodica.
