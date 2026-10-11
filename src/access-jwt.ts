import { Buffer } from "node:buffer";

/** Errores del inicio de sesion con Access, con el status HTTP que se muestra. */
export class AccessError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export type Claims = { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown; sub?: unknown; email?: unknown; name?: unknown };

/** Verifica firma (RS256 con las llaves de Access), emisor, audiencia y vigencia. */
export async function verifyIdToken(env: Env, token: string, now = Math.floor(Date.now() / 1000)): Promise<Claims> {
	const parts = token.split(".");
	if (parts.length !== 3) throw new AccessError(401, "id_token mal formado.");
	const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as { alg?: string; kid?: string };
	const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Claims;
	if (header.alg !== "RS256") throw new AccessError(401, "Algoritmo de firma no admitido.");

	const jwks = (await (await fetch(env.ACCESS_JWKS_URL)).json()) as { keys?: (JsonWebKey & { kid?: string })[] };
	const jwk = jwks.keys?.find((k) => k.kid === header.kid);
	if (!jwk) throw new AccessError(401, "Llave de firma desconocida.");
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
	const valid = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		key,
		Buffer.from(parts[2], "base64url"),
		new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
	);
	if (!valid) throw new AccessError(401, "Firma no valida.");

	const issOrigin = new URL(env.ACCESS_TOKEN_URL).origin;
	if (typeof claims.iss !== "string" || new URL(claims.iss).origin !== issOrigin) throw new AccessError(401, "Emisor no valido.");
	const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!aud.includes(env.ACCESS_CLIENT_ID)) throw new AccessError(401, "Audiencia no valida.");
	if (typeof claims.exp !== "number" || claims.exp < now) throw new AccessError(401, "Sesion vencida.");
	if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new AccessError(401, "Token aun no valido.");
	if (typeof claims.sub !== "string" || !claims.sub) throw new AccessError(401, "Falta el usuario.");
	return claims;
}
