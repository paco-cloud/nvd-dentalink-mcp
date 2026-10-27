import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { isAllowed } from "../src/allowlist.ts";
import { buildUrl, dentalinkGet, ritmo, ultimos4 } from "../src/dentalink.ts";
import * as T from "../src/tools.ts";

ritmo.intervaloMs = 0;
ritmo.espera429Ms = 0;
import { verifyIdToken } from "../src/access-jwt.ts";

const env = {
	ALLOWED_EMAILS: "andres@novodent.mx, Maitte@novodent.mx",
	DENTALINK_BASE_URL: "https://dl.example/api/v1",
	LLAVE_DENTALINK: "t",
	ACCESS_CLIENT_ID: "cid",
	ACCESS_TOKEN_URL: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cid/token",
	ACCESS_JWKS_URL: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cid/jwks",
} as unknown as Env;

test("lista blanca de correos", () => {
	assert.equal(isAllowed(env.ALLOWED_EMAILS, "andres@novodent.mx"), true);
	assert.equal(isAllowed(env.ALLOWED_EMAILS, "MAITTE@novodent.mx"), true);
	assert.equal(isAllowed(env.ALLOWED_EMAILS, "otro@novodent.mx"), false);
	assert.equal(isAllowed(env.ALLOWED_EMAILS, "andres@novodent.mx.evil.com"), false);
	assert.equal(isAllowed(env.ALLOWED_EMAILS, undefined), false);
	assert.equal(isAllowed("", "andres@novodent.mx"), false);
});

test("celular: solo los ultimos 4", () => {
	assert.equal(ultimos4("+52 722 123 4567"), "4567");
	assert.equal(ultimos4(null), null);
	assert.equal(ultimos4(""), null);
});

test("buildUrl no sale de la base de Dentalink", () => {
	assert.equal(buildUrl(env, "dentistas", { q: "x", vacio: "" }).href, "https://dl.example/api/v1/dentistas?q=x");
	assert.throws(() => buildUrl(env, "https://evil.example/x"));
	assert.throws(() => buildUrl(env, "../../otra"));
	assert.equal(buildUrl(env, "citas", { q: '{"a":"x..y"}' }).searchParams.get("q"), '{"a":"x..y"}');
	assert.ok(buildUrl(env, "//evil.example/x").href.startsWith("https://dl.example/api/v1/"));
});

test("dentalinkGet solo usa GET y no sigue next fuera de la base", async () => {
	const calls: { url: string; method: string }[] = [];
	const orig = globalThis.fetch;
	globalThis.fetch = (async (u: URL, init: RequestInit) => {
		calls.push({ url: String(u), method: init.method ?? "GET" });
		const page = calls.length;
		const next = page === 1 ? "https://dl.example/api/v1/dentistas?page=2" : "https://evil.example/api/v1/x";
		return new Response(JSON.stringify({ data: [{ id: page }], links: { next } }), { status: 200 });
	}) as typeof fetch;
	try {
		const rows = await dentalinkGet(env, "dentistas");
		assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
		assert.equal(calls.length, 2);
		assert.ok(calls.every((c) => c.method === "GET"));
	} finally {
		globalThis.fetch = orig;
	}
});

// ── id_token de Access ──
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256" };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(claims: object, header: object = { alg: "RS256", kid: "k1" }): string {
	const data = `${b64(header)}.${b64(claims)}`;
	const sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
	return `${data}.${sig}`;
}
const good = {
	iss: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cid",
	aud: ["cid"],
	exp: 2000,
	sub: "u-1",
	email: "andres@novodent.mx",
};

test("verifyIdToken acepta un token valido y rechaza los malos", async () => {
	const orig = globalThis.fetch;
	globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch;
	try {
		const c = await verifyIdToken(env, sign(good), 1000);
		assert.equal(c.email, "andres@novodent.mx");
		await assert.rejects(verifyIdToken(env, sign({ ...good, aud: ["otra"] }), 1000), /Audiencia/);
		await assert.rejects(verifyIdToken(env, sign({ ...good, iss: "https://evil.example/x" }), 1000), /Emisor/);
		await assert.rejects(verifyIdToken(env, sign(good), 3000), /vencida/);
		await assert.rejects(verifyIdToken(env, sign(good, { alg: "none", kid: "k1" }), 1000), /Algoritmo/);
		const t = sign(good).split(".");
		await assert.rejects(verifyIdToken(env, `${t[0]}.${b64({ ...good, email: "x@evil.com" })}.${t[2]}`, 1000), /Firma/);
	} finally {
		globalThis.fetch = orig;
	}
});
