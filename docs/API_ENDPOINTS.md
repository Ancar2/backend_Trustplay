# Endpoints de la API

Prefijo base principal: `/api`

Existe un segundo prefijo para Oddswin: `/api/games/oddswin`

## Convenciones generales

- `JWT`: requiere token valido (cookie o `Authorization: Bearer ...`).
- `Admin`: requiere usuario autenticado con rol administrador.
- `Propietario`: la wallet enviada debe pertenecer al usuario autenticado.
- Las rutas de autenticacion tienen limitador de intentos.
- Las rutas de escritura usan validacion de cuerpo de la solicitud.

## Salud del servicio

### `GET /health`

- Uso: verificar que la API este activa.
- Seguridad: publica.
- Respuesta: estado simple de servicio.

## Autenticacion y acceso

### `POST /users/register`

- Uso: crear una cuenta local nueva.
- Seguridad: publica con limitador de intentos.
- Cuerpo esperado: `username`, `email`, `password`, opcional `sponsor`, `photo`, `legalAcceptance`.
- Nota legal: `legalAcceptance` debe incluir aceptación explícita de Términos, Privacidad, Cookies y Disclaimer con la versión legal vigente.
- Resultado: crea usuario no verificado y envia enlace de verificacion.

### `GET /users/verify/:token`

- Uso: confirmar correo del usuario.
- Seguridad: publica.
- Parametro de ruta: `token`.
- Resultado: activa `isVerified` del usuario.
- Compatibilidad: tambien acepta `GET /users/verify-email/:token`.

### `POST /users/resend-verification`

- Uso: reenviar un nuevo enlace de verificacion cuando el anterior expiro o no llego.
- Seguridad: publica con limitador de intentos.
- Cuerpo esperado: `email`.
- Resultado: emite un nuevo token de verificacion para cuentas pendientes y reenvia el correo.

### `POST /users/login`

- Uso: iniciar sesion con correo y contraseña.
- Seguridad: publica con limitador de intentos.
- Cuerpo esperado: `email`, `password`, opcional `legalAcceptance`.
- Nota legal: si el usuario no tiene aceptación vigente, la API exige aceptar la versión legal actual antes de continuar.
- Resultado: emite cookie con JWT y devuelve datos seguros del usuario.

### `POST /users/login/social`

- Uso: iniciar sesion con proveedor social.
- Seguridad: publica con limitador de intentos.
- Cuerpo esperado:
  - `provider` (`google`, `facebook`, `instagram`)
  - `token` para `google` y `facebook`
  - `code` o `token` para `instagram`
  - opcional `legalAcceptance`
- Resultado: inicia sesion o solicita pasos adicionales segun el caso.

### `POST /users/login/social/complete`

- Uso: completar registro social cuando falta correo.
- Seguridad: publica con limitador de intentos.
- Cuerpo esperado: `email`, `tempToken`, opcional `legalAcceptance`.
- Resultado: crea usuario y entrega sesion.

### `POST /users/logout`

- Uso: cerrar sesion.
- Seguridad: publica.
- Resultado: invalida cookie de sesion en el cliente.

### `POST /users/forgot-password`

- Uso: solicitar restablecimiento de contraseña.
- Seguridad: publica con limitador de intentos.
- Cuerpo esperado: `email`.
- Resultado: genera token temporal y envia correo de recuperacion.

### `PUT /users/reset-password/:resetToken`

- Uso: establecer nueva contraseña con token de recuperacion.
- Seguridad: publica con limitador de intentos.
- Parametro de ruta: `resetToken`.
- Cuerpo esperado: `password`.
- Resultado: actualiza contraseña y elimina token de recuperacion.

## Usuarios

### `GET /users/me`

- Uso: obtener perfil del usuario autenticado.
- Seguridad: `JWT`.
- Resultado: datos del usuario sin contraseña.

### `GET /users/sponsor/:wallet`

- Uso: obtener informacion de sponsor asociada a una wallet.
- Seguridad: publica.
- Parametro de ruta: `wallet`.

### `GET /users/sponsor-by-wallet/:wallet`

- Uso: consultar sponsor de una wallet especifica.
- Seguridad: publica.
- Parametro de ruta: `wallet`.

### `GET /users/referrals/:wallet`

- Uso: resumen de referidos de la wallet.
- Seguridad: `JWT` + `Propietario` o `Admin`.
- Parametro de ruta: `wallet`.

### `GET /users/referrals/direct/:wallet`

- Uso: listado de referidos directos.
- Seguridad: `JWT` + `Propietario` o `Admin`.
- Parametro de ruta: `wallet`.

### `GET /users/referrals/indirect/:wallet`

- Uso: listado de referidos indirectos.
- Seguridad: `JWT` + `Propietario` o `Admin`.
- Parametro de ruta: `wallet`.

### `PUT /users/profile/:id`

- Uso: actualizar perfil de usuario.
- Seguridad: `JWT` + mismo usuario o `Admin`.
- Parametro de ruta: `id`.
- Cuerpo habitual: `username`, `email`, `photo`.

### `PUT /users/password/:id`

- Uso: cambiar contraseña.
- Seguridad: `JWT` + mismo usuario o `Admin`.
- Parametro de ruta: `id`.
- Cuerpo esperado: `currentPassword`, `newPassword`.

### `POST /users/wallet`

- Uso: vincular wallet al usuario autenticado.
- Seguridad: `JWT`.
- Cuerpo esperado: `walletAddress`.
- Resultado: agrega wallet si no esta vinculada a otra cuenta.

### `PUT /users/deactivate/:id`

- Uso: desactivar cuenta.
- Seguridad: `JWT` + mismo usuario o `Admin`.
- Parametro de ruta: `id`.

### `GET /users/earnings`

- Uso: calcular ganancias acumuladas del usuario.
- Seguridad: `JWT`.

## Administracion de usuarios

### `GET /users/stats`

- Uso: estadisticas generales de usuarios.
- Seguridad: `JWT` + `Admin`.

### `GET /users/all`

- Uso: listado administrativo de usuarios.
- Seguridad: `JWT` + `Admin`.

### `GET /users/sponsor-stats/:walletAddress`

- Uso: estadisticas de rendimiento de sponsor.
- Seguridad: `JWT` + `Admin`.
- Parametro de ruta: `walletAddress`.

### `GET /oddswin/reconcile/status`

- Uso: consultar estado de la reconciliacion on-chain.
- Seguridad: `JWT` + `Admin`.
- Resultado: bloque procesado, ejecucion en curso, ultimo error y ultimo reporte.

### `POST /oddswin/reconcile`

- Uso: ejecutar reconciliacion manual entre blockchain y base de datos.
- Seguridad: `JWT` + `Admin`.
- Cuerpo opcional: `fromBlock`, `toBlock`, `maxRange`, `confirmations`, `yearStart`, `yearEnd`, `lotteryAddress`.
- Comportamiento por defecto: si no envias `fromBlock` ni `toBlock`, procesa la ventana mas reciente segun `maxRange` (por defecto 5000 bloques actuales).
- Modo rapido: si envias `lotteryAddress`, procesa solo esa loteria para reducir tiempo en instalaciones con muchas loterias.
- Resultado: sincroniza loterias detectadas en Factory, inserta cajas faltantes y recalcula estadisticas.

### `POST /oddswin/reconcile/lotteries-sync`

- Uso: sincronizar solo el catalogo de loterias (sin reconciliar cajas).
- Seguridad: `JWT` + `Admin`.
- Cuerpo opcional: `yearStart`, `yearEnd`.
- Resultado: detecta loterias on-chain y crea/actualiza loterias faltantes en base de datos.

### `GET /oddswin/reconcile/lotteries/options`

- Uso: obtener opciones de loterias para el selector de reconciliacion por loteria.
- Seguridad: `JWT` + `Admin`.
- Query opcional: `limit` (max 2000), `q` (busqueda por address/nombre/simbolo).
- Resultado: lista de loterias con `address` y `label`.

### `POST /oddswin/reconcile/stop`

- Uso: solicitar detencion de una reconciliacion en curso.
- Seguridad: `JWT` + `Admin`.
- Resultado: marca `cancelRequested=true` y el proceso se detiene al terminar el lote actual.

## Informacion institucional de Trustplay

### `GET /trustplay-info`

- Uso: obtener informacion legal y enlaces institucionales.
- Seguridad: publica.

### `PUT /trustplay-info`

- Uso: actualizar informacion legal y social de plataforma.
- Seguridad: `JWT` + `Admin`.
- Cuerpo esperado:
  - opcional `legal` (arreglo)
  - opcional `social` (arreglo)
  - opcional `legalVersion` (texto)

### `GET /legal/acceptance-audit`

- Uso: consultar auditoría de aceptaciones legales registradas.
- Seguridad: `JWT` + `Admin`.
- Query opcional:
  - `page`, `limit`
  - `email`
  - `userId`
  - `legalVersion`
  - `source` (`register_form`, `login_form`, `social_login`)

## Configuracion global

### `GET /config`

- Uso: obtener configuracion global de contratos y direcciones.
- Seguridad: publica.

### `PUT /config`

- Uso: actualizar configuracion global.
- Seguridad: `JWT` + `Admin`.
- Cuerpo esperado: cualquiera de `sponsors`, `middleware`, `factory`, `exclusiveNFT`, `usdt`, `owner`.

## Oddswin (rutas base)

Estas rutas existen bajo `/api`.

### `POST /lotteries`

- Uso: crear loteria en base de datos.
- Seguridad: `JWT` + `Admin`.
- Cuerpo esperado: al menos `address` y `stableCoin`; acepta metadatos de loteria.

### `GET /lotteries`

- Uso: listar loterias con filtros.
- Seguridad: publica.
- Filtros soportados: `year`, `status`, `owner`, `page`, `limit`.

### `GET /lotteries/:address`

- Uso: detalle de una loteria por direccion.
- Seguridad: publica.
- Parametro de ruta: `address`.

### `PUT /lotteries/:address`

- Uso: actualizar metadatos de loteria.
- Seguridad: `JWT` + `Admin`.
- Parametro de ruta: `address`.

### `PUT /lotteries/:address/event-schedule`

- Uso: anunciar fecha y hora del evento para una loteria especifica (solo cuando ya no tiene cajas disponibles).
- Seguridad: `JWT` + `Admin`.
- Parametro de ruta: `address`.
- Cuerpo requerido: `scheduledAt` (ISO con zona horaria, recomendado `-05:00` para Colombia).

### `PUT /lotteries/:address/result-video`

- Uso: fijar manualmente el video oficial de resultados para una loteria especifica.
- Seguridad: `JWT` + `Admin`.
- Parametro de ruta: `address`.
- Cuerpo requerido:
  - `videoUrl`: URL de YouTube o `videoId`.
  - `videoTitle` (opcional): titulo a mostrar en frontend.
- Comportamiento: el video queda asociado solo a esa loteria y el endpoint de live responde `status=recorded` para esa loteria (sin countdown ni proximo live).

### `GET /lottery/next-live`

- Uso: obtener automaticamente el live del proximo sorteo de Lotería de Medellín.
- Seguridad: publica.
- Respuesta estandar: `status` (`live`, `upcoming`, `scheduled_only`, `recorded`), `scheduledAt`, y opcionalmente `videoId`, `title`, `embedUrl`.
- Nota: cuando una loteria ya paso su fecha programada y ya se detecto su video, el backend la fija en `recorded` para mostrar ese video oficial y no usar cuenta regresiva ni el proximo live general.
- Query opcional:
  - `lotteryAddress`: si se envia y esa loteria tiene fecha manual anunciada, esa fecha se usa para el countdown.
  - `force=true`: fuerza refresh del cache.

### `POST /lotteries/:address/close`

- Uso: cerrar loteria y calcular premios.
- Seguridad: `JWT` + `Admin`.
- Parametro de ruta: `address`.
- Modos de uso:
  - **Sincronizacion on-chain recomendada:** enviar `txHash` (hash de la transaccion de `setWinning`).
    - El backend lee blockchain, completa automaticamente: `winningNumber`, `completed`, `winnerAddress`, `winnerSponsor`, `winnerTopBuyer`, `winnerMostReferrals`, `winnerPrize`, `sponsorPrize`, `topBuyerBoxes`, `topBuyerPrize`, `mostReferralsPrize`.
    - Tambien guarda `setWinnerTxHash` en la loteria para mostrarlo en historial.
    - Despues del cierre, sincroniza la colección `exclusiveNFT` para actualizar `pendingRewards` reales de los dueños actuales.
    - Si puede leer logs de `Transfer` del token en ese `txHash`, los premios se guardan con el valor exacto on-chain (ejemplo: `16.5`).
  - **Manual (compatibilidad):** `winningNumber`, `winnerAddress`, `winnerSponsor`, `winnerTopBuyer`, `winnerMostReferrals`, `finalPool`.

### `GET /lotteries/:address/top-buyers`

- Uso: top compradores de cajas de una loteria.
- Seguridad: publica.
- Parametro de ruta: `address`.

### `GET /lotteries/:address/top-sponsors`

- Uso: top sponsors por actividad en loteria.
- Seguridad: publica.
- Parametro de ruta: `address`.

### `POST /boxes/purchase`

- Uso: registrar compra de caja realizada en cadena.
- Seguridad: `JWT` + `Propietario`.
- Cuerpo esperado: `lotteryAddress`, `boxId`, `owner`, `transactionHash`; opcional `ticket1`, `ticket2`, `sponsor`.

### `GET /boxes/user`

- Uso: listar cajas del usuario autenticado.
- Seguridad: `JWT`.
- Filtros soportados: `walletAddress`, `lotteryAddress`, `page`, `limit`.

### `GET /boxes/lottery/:address`

- Uso: listar cajas de una loteria especifica.
- Seguridad: publica.
- Parametro de ruta: `address`.

### `POST /player/add-wallet`

- Uso: agregar wallet dentro del flujo de jugador Oddswin.
- Seguridad: `JWT`.

### `GET /player/profile/:id`

- Uso: obtener perfil de jugador.
- Seguridad: `JWT` + mismo usuario o `Admin`.
- Parametro de ruta: `id`.

### `GET /player/referrals-activity/:userId`

- Uso: actividad de referidos del jugador.
- Seguridad: `JWT` + mismo usuario o `Admin`.
- Parametro de ruta: `userId`.

### `GET /exclusive-nft/metadata/:tokenId`

- Uso: obtener metadatos de NFT exclusivo.
- Seguridad: publica.
- Parametro de ruta: `tokenId`.

### `GET /exclusive-nft/info`

- Uso: obtener datos globales del contrato NFT exclusivo.
- Seguridad: publica.

### `GET /exclusive-nft/user/:address`

- Uso: obtener informacion NFT de una wallet.
- Seguridad: publica.
- Parametro de ruta: `address`.
- Nota: esta consulta sincroniza `pendingRewards` y estado de propiedad con blockchain para la colección `exclusiveNFT`.

### `GET /exclusive-nft/holders`

- Uso: listar dueños actuales de NFT exclusivo con `tokenCount`, `pendingRewards` y `totalRegalias`.
- Seguridad: `JWT`.
- Nota: sincroniza primero la colección `exclusiveNFT` contra blockchain.

### `POST /exclusive-nft/claim-record`

- Uso: registrar reclamo de recompensa NFT.
- Seguridad: `JWT` + `Propietario`.
- Cuerpo esperado: `tokenId`, `owner`, `amount`.

### `POST /oddswin/lotteries/sync-participants`

- Uso: sincronizar estadisticas de loterias.
- Seguridad: `JWT` + `Admin`.

### `POST /lotteries/sync-participants`

- Uso: alias del proceso de sincronizacion de estadisticas.
- Seguridad: `JWT` + `Admin`.

## Oddswin (prefijo de juego)

Las rutas de Oddswin tambien estan disponibles con prefijo:

- `/api/games/oddswin`

Ejemplo:

- `/api/lotteries` y `/api/games/oddswin/lotteries` apuntan al mismo modulo.
