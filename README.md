# nvd-dentalink-mcp

Conector MCP de Dentalink para Claude, **solo lectura**, con inicio de sesión por
Cloudflare Access. Ticket: NVD-TK-17 (decisiones en NVD-TK-17a: A1, B1).

Ningún sistema existente depende de este Worker.

## Cómo está hecho

| Pieza | Qué |
|---|---|
| `src/index.ts` | `OAuthProvider` (workers-oauth-provider **1.2.3**, un solo Worker) + `createMcpHandler` (agents 0.28.0, MCP SDK v2 2.0.0). Stateless, sin Durable Objects |
| `src/access-handler.ts` | `/authorize` (consentimiento) y `/callback` (canje con Access, PKCE) con los helpers de la v1 |
| `src/access-jwt.ts` | Verifica el `id_token` de Access: firma RS256, emisor, audiencia, vigencia |
| `src/allowlist.ts` | `ALLOWED_EMAILS`, segunda barrera tras la política de Access. Se revisa al entrar **y en cada llamada** |
| `src/dentalink.ts` | Cliente **solo GET**, lista blanca de campos (`pick`) y celular enmascarado (`maskPhone`) |
| `src/server.ts` | Las herramientas. Log: solo `{herramienta, correo}` |

Rutas: `/mcp`, `/authorize`, `/callback`, `/token`, `/register` y `/.well-known/*`.

Registro de clientes: CIMD («identidad publicada de Claude») y DCR (`/register`,
por compatibilidad con MCP Inspector y «Registrar automáticamente»).

Tokens: acceso 1 h, renovación 7 días. Después, entrar de nuevo con Access.

## Estado

- [x] Fase 1 (parcial, B1): proyecto, inicio de sesión y herramienta `dentistas`
- [ ] Portar las otras 8 herramientas de `nvd-mcp.js` con su lista blanca
- [ ] **Verificar contra `nvd-mcp.js`**: `DENTALINK_BASE_URL`, el encabezado de autorización (`Token …`) y `CAMPOS_DENTISTA`

## Comprobar

```bash
npm install
npm run check   # tsc + pruebas + wrangler deploy --dry-run (no despliega)
```

## Fases 2 a 6 (cada una con OK de Paco)

**Fase 2 · Access.** Zero Trust › Access controls › Applications › Create new
application › SaaS application › nombre «Novodent · Conector Dentalink» › OIDC.

- Redirect URL: `https://nvd-dentalink-mcp.<subdominio>.workers.dev/callback`.
- Política: allow, solo andres@, maitte@, jared@, paco@ y melanie.molina@novodent.mx.
- Métodos de entrada: Google y código de un solo uso.

**Fase 3 · KV y secretos** (Paco pega cada valor; nunca en archivos):

```bash
npx wrangler kv namespace create OAUTH_KV      # pegar el id en wrangler.jsonc
npx wrangler secret put DENTALINK_TOKEN        # llave nvdasistentes
npx wrangler secret put ACCESS_CLIENT_ID
npx wrangler secret put ACCESS_CLIENT_SECRET
npx wrangler secret put ACCESS_TOKEN_URL
npx wrangler secret put ACCESS_AUTHORIZATION_URL
npx wrangler secret put ACCESS_JWKS_URL        # «Key endpoint» de la app
openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

`COOKIE_ENCRYPTION_KEY` firma la cookie que recuerda el consentimiento (30 días).

**Fase 4 · Deploy y prueba.**

```bash
npx wrangler deploy
npx @modelcontextprotocol/inspector@latest     # URL: https://…workers.dev/mcp
```

- Una cuenta autorizada ve las herramientas.
- Una cuenta fuera de la lista recibe 403.

**Fase 5 · Claude.** El Owner de Team: Organization settings › Connectors › Add ›
Custom › Web, con la URL `/mcp`. Cada persona: Customize › Connectors › Connect.

**Fase 6.** Borrar `worker-fancy-fog-1299`.

## Reversa

1. Desactivar el conector en Claude.
2. Quitar la app de Access.
3. `npx wrangler delete nvd-dentalink-mcp` y borrar el KV `OAUTH_KV`.

Para cortar a una persona sin todo eso: quitar su correo de `ALLOWED_EMAILS` y
hacer `deploy`, y quitarla de la política de Access.
