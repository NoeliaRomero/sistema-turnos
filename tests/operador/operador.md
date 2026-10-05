### E2E Tests: Operador

**Suite ID:** `OPER-E2E`
**Feature:** Operator panel actions (Llegó / Finalizar Etapa / Finalizar / No Llegó), combined groups, auto-call and game scope.

**Common preconditions:** an `operador` user assigned to the test game, with call/cancel permissions; separate browser session from reception.

---

## Test Case: `OPER-E2E-001` - A combined group is called, arrives, advances and finishes together

**Priority:** `critical` · **Tags:** @e2e @operador

### Flow Steps:
1. Seed A + B combined (5 laps) in a game with "Charla" / "En pista".
2. Reception clicks "Llamar juntos".
3. Operator clicks "Llegó", then "Finalizar Etapa", then "Finalizar" on A only.

### Expected Result:
- Both show LLAMADO (reception) / "Llamado" (operator); then both "Jugando" in Charla; then both in "En pista"; then both disappear and are `finalizado`.

---

## Test Case: `OPER-E2E-002` - "No llegó" sends the whole combination to the end of the queue, still combined

**Priority:** `critical` · **Tags:** @e2e @operador

### Flow Steps:
1. Seed A + B combined, then C; call A (the combination).
2. Operator clicks "No Llegó" on A and accepts the confirm.

### Expected Result:
- Queue order is C, A, B; A and B keep the same `combinacion_id` and restart at "Charla".
- Reception shows C first and one "A + B" card with "Combinado".

---

## Test Case: `OPER-E2E-003` - When the group in "Charla" moves to "En pista", the next waiting group is called automatically

**Priority:** `critical` · **Tags:** @e2e @operador

### Flow Steps:
1. Game with stages and auto-call every 2 s; seed groups 1 and 2; call group 1.
2. Operator: "Llegó" → "Finalizar Etapa" on group 1.

### Expected Result:
- Group 2 waits while "Charla" is occupied, then gets called automatically (`llamado_por` null) into "Charla".

---

## Test Case: `OPER-E2E-004` - An operator only sees and acts on turns of the assigned game

**Priority:** `critical` · **Tags:** @e2e @operador @security

### Expected Result:
- The panel lists only the assigned game's turns; `GET /api/turnos` returns only that game.
- On another game's turns: `llamar`, `llegar`, `finalizar` and `cancelar` → 403; their state is unchanged.

---

## Test Case: `OPER-E2E-005` - A malicious client name renders as text through call, arrival and finish

**Priority:** `critical` · **Tags:** @e2e @operador @security

### Expected Result:
- Name shown literally on waiting/called/playing cards; no injected `onerror` element; `window.__xss` undefined.

---

## Test Case: `OPER-E2E-006` - A malicious beeper number is rendered as text on the operator cards

**Priority:** `high` · **Tags:** @e2e @operador @security

### Notes:
- Regression test: the API used to accept `"7<img …>"` as a beeper (parseInt check); it now rejects non-digit beepers with 400 and the operator cards escape `biper_numero`.
