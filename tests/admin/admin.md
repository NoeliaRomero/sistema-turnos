### E2E Tests: Admin - games

**Suite ID:** `ADMIN-E2E`
**Feature:** Game configuration from the admin panel ("Juegos" tab).

---

## Test Case: `ADMIN-E2E-001` - Admin creates a game with stages, subcategories, laps and auto-call

**Priority:** `critical` · **Tags:** @e2e @admin

**Preconditions:** logged in as `admin`.

### Flow Steps:
1. Open `/admin.html` → "Juegos" tab → "Nuevo Juego".
2. Name; "Utilizar etapas" with "Charla" + "En pista"; two subcategories; "¿Este juego usa vueltas?" with 5 and 10; "Llamado automático" with 2 s.
3. "Guardar".

### Expected Result:
- Toast "Juego creado"; row shows "2 etapas", "2 subcategorías", "5 / 10 vueltas".
- API (`/api/atracciones/todas`) returns the same stages/subcategories/laps, auto-call on, 2 s.

---

## Test Case: `ADMIN-E2E-002` - Admin edits a lap option and the option keeps its id

**Priority:** `high` · **Tags:** @e2e @admin

### Flow Steps:
1. Seed a game with laps 5/10 (API).
2. "Editar" on its row, change 10 → 15, "Guardar".

### Expected Result:
- Row shows "5 / 15 vueltas"; both lap options keep their original ids.

---

## Test Case: `ADMIN-E2E-003` - Editing a game while a group is in a stage keeps that group in its stage

**Priority:** `high` · **Tags:** @e2e @admin

### Flow Steps:
1. Seed a staged game and call a group (it enters "Charla").
2. Edit any lap option of the game from the admin panel.
3. Advance the group's stage through the API.

### Expected Result:
- The group is still in "Charla" after the edit and advances to "En pista".

### Notes:
- Regression test: the game PUT used to re-create every stage row with new ids, orphaning `etapa_actual_id` of active/waiting turns (fixed: stages are now updated by id).
