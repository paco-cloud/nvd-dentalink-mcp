import { Buffer } from "node:buffer";
import {
	AuthorizationError,
	CimdFetchError,
	authorizationErrorRedirect,
	type AuthRequest,
	type ConsentDescription,
	type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { AccessError, verifyIdToken } from "./access-jwt.ts";
import { isAllowed } from "./allowlist.ts";

/**
 * /authorize y /callback. Cloudflare Access (app «Access for SaaS», OIDC) es quien
 * autentica; este Worker es el servidor OAuth que ve Claude.
 *
 * Flujo (helpers de workers-oauth-provider v1, docs/upstream-sign-in.md):
 *   GET  /authorize  pagina de consentimiento (o directo a Access si ya se aprobo)
 *   POST /authorize  aprobado: redirige a Access con PKCE
 *   GET  /callback   canjea el codigo, verifica el id_token, revisa la lista blanca
 */

type EnvWithOauth = Env & { OAUTH_PROVIDER: OAuthHelpers };
type UpstreamData = { verifier: string };

const SCOPE = ["mcp:read"];

export async function handleAccessRequest(request: Request, env: EnvWithOauth, _ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const oauth = env.OAUTH_PROVIDER;
	const remember = { secret: env.COOKIE_ENCRYPTION_KEY };

	try {
		if (request.method === "GET" && url.pathname === "/authorize") {
			const authReq = await oauth.parseAuthRequest(request);
			if (await oauth.isConsentRemembered(request, authReq, remember)) {
				return redirectToAccess(request, env, authReq);
			}
			const details = await oauth.describeConsent(authReq);
			const consent = await oauth.beginConsent(authReq);
			consent.headers.set("Content-Type", "text/html; charset=utf-8");
			return new Response(consentPage(details, consent.handle), { headers: consent.headers });
		}

		if (request.method === "POST" && url.pathname === "/authorize") {
			const form = await request.formData();
			const handle = String(form.get("handle") ?? "");
			if (form.get("decision") !== "approve") {
				const denied = await oauth.denyConsent(request, handle);
				return new Response(null, { status: 302, headers: denied.headers });
			}
			const approved = await oauth.approveConsent(request, handle, { scope: SCOPE, remember });
			return redirectToAccess(request, env, approved.request, approved.headers);
		}

		if (request.method === "GET" && url.pathname === "/callback") {
			const { request: original, data, headers } = await oauth.finishUpstream<UpstreamData>(request);
			if (url.searchParams.get("error")) {
				headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
				return new Response(null, { status: 302, headers });
			}

			const idToken = await exchangeCode(env, url.searchParams.get("code"), data.verifier, callbackUrl(request));
			const claims = await verifyIdToken(env, idToken);
			const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";

			if (!isAllowed(env.ALLOWED_EMAILS, email)) {
				return page(403, "Sin acceso", "Esta cuenta no esta autorizada para el conector de Dentalink de Novodent.");
			}

			const { redirectTo } = await oauth.completeAuthorization({
				request: original,
				// La v1 no admite ":" en userId.
				userId: encodeURIComponent(String(claims.sub)),
				metadata: { label: email },
				scope: original.scope,
				// Sin el token de Access: el servidor MCP no lo necesita.
				props: { email, name: typeof claims.name === "string" ? claims.name : email },
			});
			headers.set("Location", redirectTo);
			return new Response(null, { status: 302, headers });
		}
	} catch (error) {
		if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
		if (error instanceof AuthorizationError) return page(400, "Solicitud no valida", error.description);
		if (error instanceof CimdFetchError) return page(400, "Solicitud no valida", "No se pudo verificar la aplicacion.");
		if (error instanceof AccessError) return page(error.status, "No se pudo iniciar sesion", error.message);
		throw error;
	}

	return new Response("Not Found", { status: 404 });
}

// ── Access ───────────────────────────────────────────────────────────────


function callbackUrl(request: Request): string {
	return new URL("/callback", request.url).href;
}

async function redirectToAccess(request: Request, env: EnvWithOauth, authReq: AuthRequest, extra?: Headers): Promise<Response> {
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
	const { state, headers } = await env.OAUTH_PROVIDER.beginUpstream(authReq, {
		data: { verifier } satisfies UpstreamData,
		headers: extra,
	});
	const location = new URL(env.ACCESS_AUTHORIZATION_URL);
	location.searchParams.set("client_id", env.ACCESS_CLIENT_ID);
	location.searchParams.set("redirect_uri", callbackUrl(request));
	location.searchParams.set("response_type", "code");
	location.searchParams.set("scope", "openid email profile");
	location.searchParams.set("state", state);
	location.searchParams.set("code_challenge", challenge);
	location.searchParams.set("code_challenge_method", "S256");
	headers.set("Location", location.href);
	return new Response(null, { status: 302, headers });
}

async function exchangeCode(env: Env, code: string | null, verifier: string, redirectUri: string): Promise<string> {
	if (!code) throw new AccessError(400, "Falta el codigo de autorizacion.");
	const res = await fetch(env.ACCESS_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: env.ACCESS_CLIENT_ID,
			client_secret: env.ACCESS_CLIENT_SECRET,
			code,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		}),
	});
	if (!res.ok) throw new AccessError(502, "Cloudflare Access no acepto el codigo.");
	const body = (await res.json()) as { id_token?: unknown };
	if (typeof body.id_token !== "string") throw new AccessError(502, "Cloudflare Access no devolvio id_token.");
	return body.id_token;
}

function b64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

// ── Paginas ──────────────────────────────────────────────────────────────

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a}
button{font-size:1rem;padding:.6rem 1.2rem;margin-right:.5rem;border-radius:.4rem;border:1px solid #888;cursor:pointer}
button[value=approve]{background:#0b5cad;color:#fff;border-color:#0b5cad}.aviso{background:#fff4d6;padding:.6rem;border-radius:.4rem}`;

function consentPage(d: ConsentDescription, handle: string): string {
	const name = esc(d.clientName);
	const origin = d.clientDomain
		? `Publicada por <strong>${esc(d.clientDomain)}</strong>.`
		: "La aplicacion se registro sola; su nombre no esta verificado.";
	return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Novodent · Conector Dentalink</title><style>${STYLE}</style>
<h1>Novodent · Conector Dentalink</h1>
<p><strong>${name}</strong> pide consultar Dentalink en modo solo lectura (agenda, pacientes, laboratorio) a tu nombre.</p>
<p>${origin} El acceso se enviara a <strong>${esc(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? '<p class="aviso"><strong>El acceso va a una aplicacion en tu computadora.</strong> Continua solo si acabas de iniciar la conexion desde ahi.</p>' : ""}
<p>Despues se te pedira entrar con tu cuenta @novodent.mx.</p>
<form method="post"><input type="hidden" name="handle" value="${esc(handle)}">
<button name="decision" value="approve">Permitir</button><button name="decision" value="deny">Rechazar</button></form></html>`;
}

function page(status: number, title: string, message: string): Response {
	const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style><h1>${esc(title)}</h1><p>${esc(message)}</p></html>`;
	return new Response(html, {
		status,
		headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" },
	});
}
