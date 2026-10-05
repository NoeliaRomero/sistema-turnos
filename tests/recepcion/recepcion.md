### E2E Tests: Recepción

**Suite ID:** `RECEP-E2E`
**Feature:** Registering groups, combining waiting groups and safe rendering of client data.

**Common preconditions:** a dedicated game with stages ("Charla", "En pista"), subcategory "Adultos", laps 5/10 and no auto-call; a `recepcion` user with call/cancel permissions.

---

## Test Case: `RECEP-E2E-001` - Reception registers a group with subcategory, laps and beeper

**Priority:** `critical` · **Tags:** @e2e @recepcion

### Flow Steps:
1. Pick the game, "Adultos", "5 vueltas"; keep the auto-assigned beeper; name; 3 members.
2. "Registrar en Cola".

### Expected Result:
- Toast "<name> – Beeper N registrado"; waiting card shows 3 personas, Adultos, 5 vueltas, beeper.
- API turn: `esperando`, `vueltas = 5`, stage "Charla".

---

## Test Case: `RECEP-E2E-002` - Laps are required when the game uses them

**Priority:** `high` · **Tags:** @e2e @recepcion

### Expected Result:
- Submitting without laps shows "Seleccioná la cantidad de vueltas para este juego" and creates nothing.
- `POST /api/turnos` without `vueltas` → 400 with the same rule.

---

## Test Case: `RECEP-E2E-003` - Two waiting groups with the same laps are combined into one card

**Priority:** `critical` · **Tags:** @e2e @recepcion

### Flow Steps:
1. Seed groups A (2 p.) and B (3 p.) with 5 laps.
2. "Combinar" on A → check B → "Combinar".

### Expected Result:
- One waiting card "A + B", badge "Combinado", 5 personas, button "Llamar juntos".
- Both turns share the same `combinacion_id`.

---

## Test Case: `RECEP-E2E-004` - Groups with different laps cannot be combined

**Priority:** `critical` · **Tags:** @e2e @recepcion

### Expected Result:
- In the modal, the 10-lap group is disabled with "Otra cantidad de vueltas (10)" and "Combinar" stays disabled.
- `POST /api/turnos/combinar` → 400 "Solo se pueden combinar grupos con la misma cantidad de vueltas".

---

## Test Case: `RECEP-E2E-005` - A malicious client name renders as text and its card buttons do not execute it

**Priority:** `critical` · **Tags:** @e2e @recepcion @security

### Flow Steps:
1. Seed a group named `\');window.__xss=1//<img src=x onerror="window.__xss=1">`.
2. Open/cancel "Editar turno" and "Eliminar turno", then "Llamar".

### Expected Result:
- The name is shown literally on waiting and called cards; no element with `onerror` is inserted and `window.__xss` stays undefined.

---

## Test Case: `RECEP-E2E-006` - Confirming "Finalizar" on a playing card does not execute the client name

**Priority:** `critical` · **Tags:** @e2e @recepcion @security

### Expected Result:
- After "Finalizar" → "Sí, finalizar", the toast shows the name as text.

### Notes:
- Regression test: the finalize/cancel toasts used to interpolate the raw name into `insertAdjacentHTML` (fixed with escapeHtml).
