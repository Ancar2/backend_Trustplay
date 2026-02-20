# API Endpoints (`api_Trustplay`)

Documento operativo de endpoints actuales.

## 1) Prefijos

- Prefijo principal: `/api`
- Prefijo adicional para Oddswin (compatibilidad por juego): `/api/games/oddswin`

Notas:

- Las rutas de `oddswin.routes.js` y `config.routes.js` existen en ambos prefijos.
- Rutas de `auth`, `users`, `legal`, `trustplay` y `oddswin/admin` solo viven en `/api`.

## 2) Convenciones de seguridad

- `JWT`: requiere sesion valida (cookie o `Authorization: Bearer`).
- `Admin`: usuario autenticado con rol `admin`.
- `Owner`: wallet/recurso pertenece al usuario autenticado (o admin segun middleware).
- Rutas de auth tienen rate limit dedicado.
- Rutas de escritura tienen validacion por `requestValidation`.

---

## 3) Salud

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/api/health` | Publica | Verifica que la API esta operativa. |

---

## 4) Autenticacion

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| POST | `/api/users/register` | Publica + rate limit | Registra usuario local (con legalAcceptance). |
| GET | `/api/users/verify/:token` | Publica | Verifica correo por token. |
| POST | `/api/users/resend-verification` | Publica + rate limit | Reenvia email de verificacion. |
| POST | `/api/users/login` | Publica + rate limit | Login local, entrega cookie de sesion. |
| POST | `/api/users/login/social` | Publica + rate limit | Login social (`google`, `facebook`, `instagram`). |
| POST | `/api/users/login/social/complete` | Publica + rate limit | Completa login social cuando falta email. |
| POST | `/api/users/logout` | Publica | Cierra sesion (limpia cookie). |
| POST | `/api/users/forgot-password` | Publica + rate limit | Solicita reset de password. |
| PUT | `/api/users/reset-password/:resetToken` | Publica + rate limit | Aplica nueva password con token. |

---

## 5) Usuarios y referidos

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/api/users/me` | JWT | Perfil del usuario autenticado. |
| GET | `/api/users/sponsor/:wallet` | Publica | Sponsor de una wallet. |
| GET | `/api/users/sponsor-by-wallet/:wallet` | Publica | Sponsor de wallet con enfoque por loteria si aplica. |
| GET | `/api/users/referrals/:wallet` | JWT + Owner | Resumen de directos/indirectos. |
| GET | `/api/users/referrals/direct/:wallet` | JWT + Owner/acceso por referidos | Lista de directos. |
| GET | `/api/users/referrals/indirect/:wallet` | JWT + Owner/acceso por referidos | Lista de indirectos. |
| GET | `/api/users/referrals/lost-earnings/:wallet` | JWT + Owner | Ganancias perdidas por loteria. |
| GET | `/api/users/earnings` | JWT | Ganancia acumulada general. |
| GET | `/api/users/earnings-breakdown/:wallet` | JWT + Owner | Detalle por evento/loteria. |
| PUT | `/api/users/profile/:id` | JWT + mismo usuario/admin | Actualiza perfil. |
| PUT | `/api/users/password/:id` | JWT + mismo usuario/admin | Cambia password. |
| PUT | `/api/users/deactivate/:id` | JWT + mismo usuario/admin | Desactiva cuenta. |
| POST | `/api/users/wallet` | JWT | Vincula wallet al usuario. |
| DELETE | `/api/users/wallet/:wallet` | JWT | Desvincula wallet del usuario. |
| GET | `/api/users/legal-stats/:id` | JWT + Admin | Estadisticas legales de usuario. |

---

## 6) Administracion

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/api/users/stats` | JWT + Admin | KPIs de usuarios. |
| GET | `/api/users/all` | JWT + Admin | Listado administrativo de usuarios. |
| GET | `/api/users/sponsor-stats/:walletAddress` | JWT + Admin | Estadisticas de sponsor puntual. |

### Reconciliacion on-chain

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/api/oddswin/reconcile/status` | JWT + Admin | Estado de reconciliacion. |
| GET | `/api/oddswin/reconcile/lotteries/options` | JWT + Admin | Opciones de loterias para reconciliar. |
| POST | `/api/oddswin/reconcile` | JWT + Admin | Reconciliacion completa blockchain -> DB. |
| POST | `/api/oddswin/reconcile/lotteries-sync` | JWT + Admin | Sincroniza solo catalogo de loterias. |
| POST | `/api/oddswin/reconcile/stop` | JWT + Admin | Solicita detener reconciliacion en curso. |

---

## 7) Legal (versionado auditable)

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/api/legal/documents` | Publica (con sesion opcional) | Lista documentos vigentes + pendientes del usuario si hay sesion. |
| GET | `/api/legal/documents/:key` | Publica (con sesion opcional) | Documento vigente con metadata y contenido. |
| POST | `/api/legal/accept` | JWT | Registra aceptacion (`versionId`, `sha256`, `ip`, `userAgent`). |
| GET | `/api/legal/documents/:key/versions` | JWT + Admin | Historial de versiones por documento. |
| POST | `/api/legal/documents/:key/versions` | JWT + Admin | Crea nueva version legal. |
| PUT | `/api/legal/documents/:key/versions/:versionId/publish` | JWT + Admin | Publica/activa version legal. |
| GET | `/api/legal/acceptance-audit` | JWT + Admin | Auditoria de aceptaciones registradas. |

---

## 8) Trustplay institucional

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/api/trustplay-info` | Publica | Informacion institucional (social + legal derivado). |
| PUT | `/api/trustplay-info` | JWT + Admin | Actualiza contenido institucional permitido. |

---

## 9) Configuracion global (contratos)

Disponible en ambos prefijos:

- `/api/config`
- `/api/games/oddswin/config`

| Metodo | Ruta | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/config` | Publica | Lee direcciones/config actual. |
| PUT | `/config` | JWT + Admin | Actualiza direcciones de contratos. |

---

## 10) Oddswin (loterias, cajas, player, NFT)

Las siguientes rutas existen en:

- `/api/...`
- `/api/games/oddswin/...`

### Loterias

| Metodo | Ruta base | Seguridad | Descripcion |
|---|---|---|---|
| POST | `/lotteries` | JWT + Admin | Crea loteria en DB. |
| GET | `/lotteries` | Publica | Lista loterias con filtros/paginacion. |
| GET | `/lotteries/:address` | Publica | Detalle por direccion de loteria. |
| PUT | `/lotteries/:address` | JWT + Admin | Actualiza metadata de loteria. |
| PUT | `/lotteries/:address/event-schedule` | JWT + Admin | Define fecha/hora oficial del evento. |
| GET | `/lottery/next-live` | Publica | Live/upcoming/scheduled_only/recorded para resultados oficiales. |
| PUT | `/lotteries/:address/result-video` | JWT + Admin | Fija video oficial para una loteria cerrada. |
| POST | `/lotteries/:address/close` | JWT + Admin | Cierra loteria y completa premios (manual o via `txHash`). |
| GET | `/lotteries/:address/top-buyers` | Publica | Top compradores por loteria. |
| GET | `/lotteries/:address/top-sponsors` | Publica | Top sponsors por loteria. |
| POST | `/lotteries/sync-participants` | JWT + Admin | Sincroniza estadisticas de participantes. |
| POST | `/oddswin/lotteries/sync-participants` | JWT + Admin | Alias legacy del sync de participantes. |

### Cajas

| Metodo | Ruta base | Seguridad | Descripcion |
|---|---|---|---|
| POST | `/boxes/purchase` | JWT + Owner | Registra compra de caja confirmada on-chain. |
| GET | `/boxes/user` | JWT | Lista cajas del usuario autenticado. |
| GET | `/boxes/lottery/:address` | Publica | Lista cajas por loteria. |

### Player / Referidos Oddswin

| Metodo | Ruta base | Seguridad | Descripcion |
|---|---|---|---|
| POST | `/player/add-wallet` | JWT | Vincula wallet en flujo player. |
| GET | `/player/profile/:id` | JWT + mismo usuario/admin | Perfil del jugador. |
| GET | `/player/referrals-activity/:userId` | JWT + mismo usuario/admin | Actividad de referidos del jugador. |

### NFT Exclusivo

| Metodo | Ruta base | Seguridad | Descripcion |
|---|---|---|---|
| GET | `/exclusive-nft/metadata/:tokenId` | Publica | Metadata por tokenId. |
| GET | `/exclusive-nft/info` | Publica | Info global del contrato NFT exclusivo. |
| GET | `/exclusive-nft/user/:address` | Publica | Estado NFT de una wallet (sync on-chain). |
| GET | `/exclusive-nft/holders` | JWT | Holders actuales con rewards/regalias. |
| POST | `/exclusive-nft/claim-record` | JWT + Owner | Registra reclamo de rewards NFT. |

---

## 11) Endpoints no encontrados

Cualquier ruta fuera del catalogo devuelve:

- `404 { "msj": "Endpoint no encontrado" }`
