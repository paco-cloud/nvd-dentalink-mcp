# nvd-dentalink-mcp

**URL del conector:** `https://nvd-dentalink-mcp.novomedia.workers.dev/mcp`

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
| `src/dentalink.ts` | Cliente **solo GET**: 1 consulta cada 1.1 s, reintento en 429, paginación solo dentro de la base |
| `src/tools.ts` | Las 9 herramientas, portadas de `nvd-mcp.js`. Cada respuesta se arma campo por campo (lista blanca) |
| `src/perfiles.ts` | **NVD-TK-41:** perfil por llamada desde `NVD · Catálogos › USUARIOS_ROLES` (Sheets, cuenta de servicio `GOOGLE_SA_JSON`, cache 5 min). Falla cerrado. `PERFILES_MODO`: `apagado` (reversa) · `sombra` (registra lo que negaría) · `activo` (niega) |
| `src/server.ts` | Registro MCP con validación de entradas (zod). Log: solo `{herramienta, correo, perfil, modo, resultado, motivo}` |

Rutas: `/mcp`, `/authorize`, `/callback`, `/token`, `/register` y `/.well-known/*`.

Registro de clientes: CIMD («identidad publicada de Claude») y DCR (`/register`,
por compatibilidad con MCP Inspector y «Registrar automáticamente»).

Tokens: acceso 1 h, renovación 7 días. Después, entrar de nuevo con Access.

## Estado

- [x] Fase 1: proyecto, inicio de sesión y las 9 herramientas de `nvd-mcp.js`
- [x] Fases 2 y 3: app de Access y 7 secretos, desde el panel (11-oct-2026). Pendiente: fases 4 a 7 · Despliegue por Workers Builds

## Herramientas

| Herramienta | Qué devuelve |
|---|---|
| `agenda_dia` | Citas de un día (sin canceladas ni reprogramadas). Hasta 60 |
| `confirmaciones_pendientes` | Citas sin confirmar de los próximos 1 a 7 días (2 por defecto) |
| `citas_proximas` | Citas de los próximos 1 a 7 días (3 por defecto), opcionalmente de un profesional. Hasta 80 |
| `buscar_paciente` | Hasta 5 pacientes por nombre, apellido o celular: alias, nombre, File y últimos 4 del celular |
| `citas_paciente` | Próximas 5 y últimas 5 citas de un File |
| `huecos` | Horarios libres de la agenda en línea (mañana y 30 min por defecto). Hasta 40 |
| `dentistas` | Catálogo de profesionales: id, nombre, especialidad, habilitado |
| `laboratorio_paciente` | Prestaciones de hasta 4 planes activos con estado y solicitud a laboratorio |
| `laboratorios` | Catálogo de laboratorios |

Cada cita sale solo con: fecha, hora, duración, profesional, consultorio, estado,
paciente (alias o nombre), File e id de la cita. Solo sucursal 1.

Nunca salen evoluciones, diagnósticos, comentarios clínicos, montos ni el
celular completo. Las pruebas (`test/tools.test.ts`) lo comprueban con datos
falsos que sí traen esos campos.

## Comprobar

```bash
npm install
npm run check   # tsc + pruebas + wrangler deploy --dry-run (no despliega)
```

## Fases 2 a 6 (cada una con OK de Paco)

**Fase 2 · Access.** Zero Trust › Access controls › Applications › Create new
application › SaaS application › nombre «Novodent · Conector Dentalink» › OIDC.

- Redirect URL: `https://nvd-dentalink-mcp.novomedia.workers.dev/callback`.
- Política: allow, solo andres@, maitte@, jared@, paco@ y melanie.molina@novodent.mx.
- Métodos de entrada: Google y código de un solo uso.

**Fase 3 · KV y secretos** (Paco pega cada valor; nunca en archivos):

```bash
# El KV OAUTH_KV ya existe (id en wrangler.jsonc), creado el 12-oct-2026.
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
npx @modelcontextprotocol/inspector@latest     # URL: https://nvd-dentalink-mcp.novomedia.workers.dev/mcp
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
