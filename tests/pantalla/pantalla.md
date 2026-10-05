### E2E Tests: Pantalla pública (TV)

**Suite ID:** `TV-E2E`
**Feature:** Public TV screen (`/pantalla.html`) fed by `/api/turnos/cola-publica` and socket.io.

---

## Test Case: `TV-E2E-001` - The public screen shows a called group without being logged in

**Priority:** `critical`

**Tags:**
- type → @e2e
- feature → @pantalla

**Description/Objective:** An anonymous browser sees queue changes live, including a group being called.

**Preconditions:**
- A game with stages and one waiting group (seeded via API).
- A browser session with no cookies (`/api/auth/me` → 401).

### Flow Steps:
1. Open `/pantalla.html` anonymously.
2. Call the group through the API while the screen is open.

### Expected Result:
- Before the call, the group is listed under "En Espera" of its game card.
- After the call, it moves to "En Juego" with the "Llamado" chip, its beeper and the "Charla" stage.

### Notes:
- Requires an active license: `/api/turnos/cola-publica` is behind the license gate.
