### E2E Tests: Login

**Suite ID:** `LOGIN-E2E`
**Feature:** Username/password login with role-based redirect.

---

## Test Case: `LOGIN-E2E-001` - Admin with valid credentials is redirected to the admin panel

**Priority:** `critical`

**Tags:**
- type → @e2e
- feature → @login

**Description/Objective:** The seeded admin account logs in and lands on `/admin.html`.

**Preconditions:**
- Fresh DB seeded with `admin` / `admin123`.

### Flow Steps:
1. Open `/login.html`.
2. Fill "Usuario" and "Contraseña" with the admin credentials.
3. Click "Ingresar".

### Expected Result:
- URL is `/admin.html` and the "Administración" navbar is shown.

---

## Test Case: `LOGIN-E2E-002` - Wrong password shows an error and stays on the login page

**Priority:** `critical`

**Tags:**
- type → @e2e
- feature → @login

**Description/Objective:** A wrong password is rejected with a visible error.

### Flow Steps:
1. Open `/login.html`.
2. Log in as `admin` with a wrong password.

### Expected Result:
- Alert shows "Usuario o contraseña incorrectos".
- URL stays on `/login.html`.
