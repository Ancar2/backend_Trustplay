# Backend - API Trustplay 🎲

Este backend maneja la lógica de negocio para la plataforma de lotería descentralizada. Se encarga de la autenticación de usuarios, gestión de perfiles, registro de compras de lotería (tickets), cálculo de recompensas y estadísticas para administradores y sponsors.

Está construido con **Node.js**, **Express**, y **MongoDB**.

---

## 📂 Estructura de Controladores

La API está organizada en controladores globales y específicos del juego ("Oddswin").

### 1. Auth Controllers (Registro y Login)

#### `register.controller.js`

* **Función**: `register`
* **Descripción**: Crea un nuevo usuario en la base de datos.
* **Método**: `POST /users/register`
* **Body**: `{ username, email, password, wallets (opcional), sponsor (opcional) }`
* **Retorno**:

    ```json
    {
      "token": "JWT_TOKEN...",
      "user": { "_id", "username", "email", "role", "wallets", "sponsor", "photo" }
    }
    ```

#### `login.controller.js`

* **Función**: `login`
* **Descripción**: Autentica al usuario mediante email y contraseña.
* **Método**: `POST /users/login`
* **Body**: `{ email, password }`
* **Retorno**:

    ```json
    {
      "token": "JWT_TOKEN...",
      "user": { "_id", "username", "email", "role", "wallets", "sponsor", "photo" }
    }
    ```

---

### 2. User Controllers (Gestión de Cuenta)

#### `user.controller.js` (Lógica Global)

Para configuraciones de la cuenta del usuario.

* **`updateProfile`** (`PUT /users/profile/:id`)
  * Actualiza username, email o foto.
  * Retorna el objeto usuario actualizado y un nuevo token.

* **`updatePassword`** (`PUT /users/password/:id`)
  * Cambia la contraseña (requiere `currentPassword` y `newPassword`).

* **`deactivateAccount`** (`PUT /users/deactivate/:id`)
  * Desactiva la cuenta (Soft Delete).

---

### 3. Player Controllers (Lógica de Juego - Oddswin)

#### `oddswin/player.controller.js`

Maneja la identidad del jugador dentro del juego.

* **`addWallet`** (`POST /player/add-wallet`)
  * Vincula una wallet Web3 al perfil del usuario.
  * Validación: Verifica que la wallet haya comprado tickets antes de vincularse.

* **`getUserProfile`** (`GET /player/profile/:id`)
  * Obtiene el perfil completo del jugador, incluyendo estadísticas de juego agregadas.

* **Retorno**:

    ```json
    {
      "_id": "...",
        "username": "...",
        "boxesAcquired": [
        {
            "lotteryName": "Lotería #1",
            "lotterySymbol": "LOT1",
            "boxesCount": 5,
            "image": "url..."
        }
        ]
    }
    ```

#### `oddswin/sponsor.controller.js`

Maneja la lógica del sistema de referidos.

* **`getReferralsActivity`** (`GET /player/referrals-activity/:userId`)
  * Muestra qué han comprado tus referidos.
  * **Retorno**: Lista de referidos con sus compras agrupadas por transacción.
  
    ```json
    [
        {
        "referral": { "username": "...", "photo": "..." },
        "purchases": [
            {
            "lotteryName": "Lotería Mensual",
            "boxesCount": 2,
            "date": "2023-...",
            "boxes": [{ "boxId": 1, "ticket1": 10, "ticket2": 20 }]
            }
        ]
        }
    ]
    ```

---

### 4. Game Controllers (Loterías y Compras)

#### `oddswin/lottery.controller.js`

Gestión del ciclo de vida de las loterías.

* **`createLottery`** (`POST /lotteries`) **[ADMIN]**
  * Registra una nueva lotería creada en la blockchain.

* **`getLotteries`** (`GET /lotteries?page=1&limit=20`)
  * Lista loterías paginadas.

* **`closeLottery`** (`POST /lotteries/:address/close`) **[ADMIN]**
  * Cierra una lotería y registra los ganadores y premios finales distribuidos.

#### `oddswin/box.controller.js`

Gestión de compras de tickets (Boxes).

* **`registerBoxPurchase`** (`POST /boxes/purchase`)
  * Registra la compra de una "Box" (contiene 2 tickets). Se llama tras confirmación en blockchain.

* **`getUserBoxes`** (`GET /boxes/user`)
  * Obtiene todas las boxes compradas por el usuario actual (paginado).
  * **Nota**: Utiliza las wallets vinculadas al usuario del token JWT. No requiere enviar address.

---

### 5. Admin Controllers

#### `oddswin/admin.controller.js`

Dashboard exclusivo para administradores.

* **`getUserStats`** (`GET /users/stats`) **[ADMIN]**
  * Retorna métricas globales: Total de usuarios, usuarios registrados hoy, etc.

* **`getSponsorStats`** (`GET /users/sponsor-stats/:walletAddress`) **[ADMIN]**
  * Auditoría de un sponsor específico.
  * **Retorno**:

    ```json
    {
        "sponsorAddress": "0x...",
        "referrals": 150,
        "uplineDirect": "0xPadre...",
        "uplineIndirect": "0xAbuelo..."
    }
    ```

## 🛡️ Seguridad Implementada

1. **JWT Authentication**: `verifyToken` middleware protege rutas privadas.

2. **Role Based Access Control (RBAC)**: `isAdmin` middleware protege rutas críticas de administración.

3. **Helmet**: Protección de cabeceras HTTP.

4. **Rate Limiting**: Protección contra fuerza bruta (100 peticiones / 15 min por IP).

5. **Input Validation**: Todos los endpoints validan los datos de entrada antes de procesar.

6. **Error Handling**: Los errores internos se registran en el servidor (`console.error`) pero al cliente solo se le muestra un mensaje genérico para evitar fuga de información sensible.

---

## Versionado legal

El módulo legal ahora se maneja con tres colecciones auditables:

- `legal_documents`: define el documento (`key`, `title`, `currentVersionId`, `status`).
- `legal_document_versions`: versionado por documento (`version`, `effectiveAt`, `contentUrl/contentHtml`, `sha256`, `isPublished`).
- `legal_acceptances`: evidencia de aceptación por usuario (`userId`, `documentKey`, `versionId`, `sha256`, `acceptedAt`, `ip`, `userAgent`).

Flujo recomendado:

1. Admin crea versión con `POST /api/legal/documents/:key/versions`.
2. Admin publica versión con `PUT /api/legal/documents/:key/versions/:versionId/publish`.
3. Usuario consulta `GET /api/legal/documents` y acepta con `POST /api/legal/accept`.

Seed de ejemplo:

- Ejecutar `npm run seed:legal` para cargar `terms` y `privacy` con versiones `1.0.0` y `1.1.0`.
