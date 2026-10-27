import OAuthProvider, { type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { handleAccessRequest } from "./access-handler.ts";
import { exportar } from "./bitacora.ts";
import { appendFilas } from "./perfiles.ts";
import { isAllowed } from "./allowlist.ts";
import { createServer } from "./server.ts";

/**
 * nvd-dentalink-mcp · NVD-TK-17
 *
 * Un solo Worker que es servidor de autorizacion y recurso (OAuthProvider de
 * workers-oauth-provider v1). El MCP es stateless (createMcpHandler); no hay
 * Durable Objects.
 *
 * Rutas: /mcp (MCP), /authorize, /callback, /token, /register y las
 * /.well-known/* que publica la libreria.
 */

const SCOPE = "mcp:read";

const mcpApi = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const props = ctx.props as { email?: unknown } | undefined;
		// Segunda revision en cada llamada: quitar a alguien de ALLOWED_EMAILS
		// corta el acceso aunque su token siga vigente.
		if (!isAllowed(env.ALLOWED_EMAILS, props?.email)) {
			return new Response("Forbidden", { status: 403 });
		}
		return createMcpHandler(() => createServer(env))(request, env, ctx);
	},
};

function options(origin: string): OAuthProviderOptions<Env> {
	return {
		apiRoute: "/mcp",
		apiHandler: mcpApi,
		defaultHandler: { fetch: handleAccessRequest as any },
		authorizeEndpoint: "/authorize",
		tokenEndpoint: "/token",
		// DCR: MCP 2026-07-28 lo depreca, pero se deja por compatibilidad con
		// clientes que aun no usan CIMD (MCP Inspector, «Registrar automaticamente»).
		clientRegistrationEndpoint: "/register",
		clientIdMetadataDocumentEnabled: true,
		resourceMetadata: { resource: `${origin}/mcp` },
		scopesSupported: [SCOPE],
		requiredScopes: [SCOPE],
		accessTokenTTL: 60 * 60, // 1 h
		refreshTokenTTL: 7 * 24 * 60 * 60, // 7 dias; despues, entrar de nuevo con Access
	};
}

// El recurso canonico sale del origen real (workers.dev hoy). Un proveedor por origen.
const providers = new Map<string, OAuthProvider<Env>>();

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const origin = new URL(request.url).origin;
		let provider = providers.get(origin);
		if (!provider) {
			provider = new OAuthProvider<Env>(options(origin));
			providers.set(origin, provider);
		}
		return provider.fetch(request, env, ctx);
	},
	// NVD-TK-41 fase 4: cada dia (cron) la bitacora de ayer pasa a BITACORA_CONSULTAS.
	async scheduled(_evento: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(
			exportar(env, appendFilas).catch((err) => {
				console.log(JSON.stringify({ evento: "bitacora", resultado: "exporte_fallido", causa: err instanceof Error ? err.message : "error" }));
			}),
		);
	},
} satisfies ExportedHandler<Env>;
