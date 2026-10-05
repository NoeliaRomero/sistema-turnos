import { test as base, expect, request, type APIRequestContext, type APIResponse, type Browser, type Page } from '@playwright/test';

// ── Seeded credentials (db/database.js creates them on a fresh DB) ──────────────
export const ADMIN      = { username: 'admin',      password: 'admin123' } as const;
export const SUPERADMIN = { username: 'superadmin', password: 'super123' } as const;
export const TEST_PASSWORD = 'Test1234!';

// The XSS payload used by the regression tests (breaks out of '...' in onclick
// attributes AND injects an <img onerror> if it is ever parsed as HTML).
export const XSS_NAME = `\\');window.__xss=1//<img src=x onerror="window.__xss=1">`;

// ── Unique test data ────────────────────────────────────────────────────────────
let seq = 0;
const runTag = Date.now().toString(36).slice(-4);

export function uniqueName(prefix: string): string {
  seq += 1;
  return `${prefix} ${runTag}${seq}`;
}

// Beeper numbers for API-created turns. Any number except 4 is accepted by the
// server; starting high keeps them away from the numbers the reception form
// auto-assigns (1, 2, 3…), so UI-created turns never collide with seeded ones.
let beeperSeq = 100 + (Date.now() % 5000);
export function nextBeeper(): string {
  beeperSeq += 1;
  return String(beeperSeq);
}

// ── Domain types (subset of what the API returns) ───────────────────────────────
export interface Game {
  id: number;
  nombre: string;
  etapas: { id: number; nombre: string; orden: number }[];
  subcategorias: { id: number; nombre: string }[];
  vueltas: { id: number; cantidad: number }[];
  [column: string]: unknown;
}

export interface TurnOptions {
  nombre?: string;
  miembros?: number;
  vueltas?: number;
  subcategoria?: string;
  biper?: string;
}

export interface Turn {
  id: number;
  atraccion_id: number;
  biper_numero: string;
  nombre_cliente: string | null;
  estado: 'esperando' | 'llamado' | 'jugando' | 'finalizado' | 'cancelado';
  combinacion_id: number | null;
  vueltas: number | null;
  orden_cola: number | null;
  etapa_actual_id: number | null;
  etapa_actual_nombre?: string | null;
}

export interface GameOptions {
  nombre?: string;
  etapas?: string[];
  subcategorias?: string[];
  vueltas?: number[];
  llamadoAutomaticoSeg?: number;
  maxMiembros?: number;
}

export interface UserOptions {
  rol: 'recepcion' | 'operador' | 'admin';
  atraccionId?: number;
  permisoLlamar?: boolean;
  permisoCancelar?: boolean;
}

export interface Credentials { username: string; password: string; }

// ── API client (seeds data through the app's own HTTP API) ──────────────────────
export class ApiClient {
  private readonly createdGames: number[] = [];
  private readonly createdUsers: number[] = [];

  private constructor(readonly ctx: APIRequestContext) {}

  static async login(baseURL: string, creds: Credentials): Promise<ApiClient> {
    const ctx = await request.newContext({ baseURL });
    const res = await ctx.post('/api/auth/login', { data: creds });
    expect(res.status(), `login as ${creds.username}`).toBe(200);
    return new ApiClient(ctx);
  }

  async createGame(opts: GameOptions = {}): Promise<Game> {
    const usaEtapas = !!opts.etapas?.length;
    const res = await this.ctx.post('/api/atracciones', {
      data: {
        nombre:            opts.nombre ?? uniqueName('Juego'),
        duracion_minutos:  20,
        min_miembros:      1,
        max_miembros:      opts.maxMiembros ?? 20,
        usa_etapas:        usaEtapas,
        etapas:            (opts.etapas ?? []).map(nombre => ({ nombre, duracion_minutos: 10 })),
        usa_subcategorias: !!opts.subcategorias?.length,
        subcategorias:     (opts.subcategorias ?? []).map(nombre => ({ nombre })),
        usa_vueltas:       !!opts.vueltas?.length,
        vueltas:           (opts.vueltas ?? []).map(cantidad => ({ cantidad })),
        llamado_automatico:             !!opts.llamadoAutomaticoSeg,
        tiempo_entre_llamados_segundos: opts.llamadoAutomaticoSeg ?? null,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const game = (await res.json()) as Game;
    this.createdGames.push(game.id);
    return game;
  }

  /** Registers a game created through the UI so it is cleaned up too. */
  async trackGameByName(nombre: string): Promise<Game> {
    const game = await this.findGame(nombre);
    this.createdGames.push(game.id);
    return game;
  }

  async findGame(nombre: string): Promise<Game> {
    const res = await this.ctx.get('/api/atracciones/todas');
    const game = ((await res.json()) as Game[]).find(g => g.nombre === nombre);
    if (!game) throw new Error(`Game "${nombre}" not found`);
    return game;
  }

  async createUser(opts: UserOptions): Promise<Credentials & { id: number }> {
    const username = uniqueName(opts.rol).replace(/\s+/g, '_').toLowerCase();
    const res = await this.ctx.post('/api/usuarios', {
      data: {
        nombre:                 `E2E ${opts.rol} ${username}`,
        username,
        password:               TEST_PASSWORD,
        rol:                    opts.rol,
        atraccion_id:           opts.atraccionId ?? null,
        permiso_llamar_turno:   opts.permisoLlamar ?? true,
        permiso_cancelar_turno: opts.permisoCancelar ?? true,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { id } = await res.json();
    this.createdUsers.push(id);
    return { id, username, password: TEST_PASSWORD };
  }

  async createTurn(game: Game, opts: TurnOptions = {}): Promise<Turn> {
    const res = await this.tryCreateTurn(game, opts);
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()) as Turn;
  }

  /** Same request as createTurn, but returns the raw response (for rejection tests). */
  async tryCreateTurn(game: Game, opts: TurnOptions = {}): Promise<APIResponse> {
    const sub = opts.subcategoria
      ? game.subcategorias.find(s => s.nombre === opts.subcategoria)
      : game.subcategorias[0];
    return this.ctx.post('/api/turnos', {
      data: {
        atraccion_id:      game.id,
        biper_numero:      opts.biper ?? nextBeeper(),
        nombre_cliente:    opts.nombre ?? uniqueName('Familia'),
        cantidad_miembros: opts.miembros ?? 2,
        subcategoria_id:   sub?.id ?? null,
        vueltas:           opts.vueltas ?? null,
        confirmar_biper_otro_juego: true,
      },
    });
  }

  async combine(base: Turn, others: Turn[]): Promise<void> {
    const res = await this.ctx.post('/api/turnos/combinar', { data: { turno_id: base.id, con: others.map(t => t.id) } });
    expect(res.status(), await res.text()).toBe(200);
  }

  async call(turn: Turn): Promise<void> {
    const res  = await this.ctx.put(`/api/turnos/${turn.id}/llamar`, { data: {} });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.advertencia, JSON.stringify(body)).toBeUndefined();
  }

  async turnsOf(game: Game): Promise<Turn[]> {
    const res = await this.ctx.get(`/api/turnos?atraccion_id=${game.id}`);
    expect(res.status()).toBe(200);
    return (await res.json()) as Turn[];
  }

  async turn(id: number, game: Game): Promise<Turn> {
    const t = (await this.turnsOf(game)).find(x => x.id === id);
    if (!t) throw new Error(`Turn ${id} not found`);
    return t;
  }

  /** Polls until every given turn reaches `estado`. */
  async expectStates(game: Game, ids: number[], estado: Turn['estado']): Promise<void> {
    await expect.poll(async () => {
      const turns = await this.turnsOf(game);
      return ids.map(id => turns.find(t => t.id === id)?.estado);
    }, { message: `turns ${ids.join(',')} → ${estado}` }).toEqual(ids.map(() => estado));
  }

  /** Cancels/deletes every turn of the games this client created, then deletes games and users. */
  async cleanup(): Promise<void> {
    for (const gameId of this.createdGames.splice(0)) {
      // A pending auto-call may move a waiting turn to 'llamado' mid-cleanup,
      // which makes the game delete fail with 409: retry a few passes.
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await this.ctx.get(`/api/turnos?atraccion_id=${gameId}`);
        const turns = res.ok() ? ((await res.json()) as Turn[]) : [];
        for (const t of turns.filter(x => x.estado === 'esperando')) {
          await this.ctx.delete(`/api/turnos/${t.id}`);
        }
        for (const t of turns.filter(x => x.estado === 'llamado' || x.estado === 'jugando')) {
          await this.ctx.put(`/api/turnos/${t.id}/cancelar-turno`);
        }
        const del = await this.ctx.delete(`/api/atracciones/${gameId}`);
        if (del.ok() || del.status() === 404) break;
      }
    }
    for (const userId of this.createdUsers.splice(0)) {
      await this.ctx.delete(`/api/usuarios/${userId}`);
    }
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

// ── Browser helpers ─────────────────────────────────────────────────────────────

/** Logs a page in through the API (cookies are shared with the browser context). */
export async function loginAs(page: Page, creds: Credentials): Promise<void> {
  const res = await page.request.post('/api/auth/login', { data: creds });
  expect(res.status(), `login as ${creds.username}`).toBe(200);
}

/** Opens a new isolated browser session (own cookies) logged in as `creds`. */
export async function newSessionPage(browser: Browser, baseURL: string, creds?: Credentials): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await installXssProbe(page);
  if (creds) await loginAs(page, creds);
  return page;
}

/**
 * Records every element with an inline `onerror` handler that gets inserted in
 * the document. The app itself never renders one, so any hit means user data
 * was parsed as HTML. Must be installed before navigation.
 */
export async function installXssProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __xssInjected: string[] };
    w.__xssInjected = [];
    const check = (node: Node) => {
      if (node.nodeType !== 1) return;
      const el = node as Element;
      const hits = [el, ...Array.from(el.querySelectorAll('[onerror]'))].filter(e => e.hasAttribute('onerror'));
      hits.forEach(e => w.__xssInjected.push(e.outerHTML));
    };
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(check)))
      .observe(document, { childList: true, subtree: true });
  });
}

/** Asserts the XSS payload was neither parsed as HTML nor executed as JS. */
export async function expectNoXss(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const w = window as unknown as { __xss?: unknown; __xssInjected?: string[] };
    return { executed: w.__xss, injected: w.__xssInjected ?? [] };
  });
  expect(state.injected, 'user data was injected as HTML').toEqual([]);
  expect(state.executed, 'window.__xss was set by injected code').toBeUndefined();
}

// ── Fixtures ────────────────────────────────────────────────────────────────────
type Fixtures = {
  /** Admin API client; everything it creates is cleaned up after the test. */
  adminApi: ApiClient;
  /** Opens an extra browser session (own cookies), closed after the test. */
  openSession: (creds?: Credentials) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  adminApi: async ({ baseURL }, use) => {
    const api = await ApiClient.login(baseURL!, ADMIN);
    await use(api);
    await api.cleanup();
    await api.dispose();
  },
  openSession: async ({ browser, baseURL }, use) => {
    const pages: Page[] = [];
    await use(async creds => {
      const p = await newSessionPage(browser, baseURL!, creds);
      pages.push(p);
      return p;
    });
    for (const p of pages) await p.context().close();
  },
  page: async ({ page }, use) => {
    await installXssProbe(page);
    await use(page);
  },
});

export { expect };
