/**
 * Pruebas de NVD-TK-41 fase 1 (perfil por llamada). Google se simula: nada sale a
 * Sheets. Llave RSA generada al vuelo; correos y perfiles falsos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import * as P from "../src/perfiles.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sa = {
	client_email: "sa-prueba@proyecto.iam.gserviceaccount.com",
	private_key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
	token_uri: "https://oauth2.example/token",
};

const env = (modo: string) =>
	({
		GOOGLE_SA_JSON: JSON.stringify(sa),
		PERFILES_SHEET_ID: "hoja-falsa",
		PERFILES_MODO: modo,
	}) as unknown as Env;

// Filas A:L como las devuelve Sheets. Solo correo (A), E, F, G, H y K importan.
const fila = (correo: string, perfil: string, o: Partial<{ pagos: string; anula: string; evol: string; activo: string }> = {}) => [
	correo, "Nombre Falso", "puesto", "FALSE", o.pagos ?? "FALSE", o.anula ?? "FALSE", o.evol ?? "FALSE", o.activo ?? "TRUE", "FALSE", "", perfil, "",
];
const HOJA = [
	fila("ana@novodent.mx", "Atención a Clientes"),
	fila("Beto@novodent.mx", "Jefatura administrativa", { pagos: "TRUE", anula: "TRUE" }),
	fila("cris@novodent.mx", "Auxiliar clínico", { evol: "TRUE" }),
	fila("dani@novodent.mx", "Por confirmar"),
	fila("eli@novodent.mx", "Dirección", { activo: "FALSE" }),
	fila("fer@otrodominio.com", "Dirección"),
	fila("gus@novodent.mx", "Perfil inventado"),
];

function simular(sheets: () => Response) {
	const llamadas: string[] = [];
	const logs: string[] = [];
	const f = globalThis.fetch;
	const log = console.log;
	globalThis.fetch = (async (u: URL | string, init?: RequestInit) => {
		const url = String(u);
		llamadas.push(url);
		if (url === sa.token_uri) {
			const asercion = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
			const [h, c, s] = asercion.split(".");
			const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"));
			return new Response(JSON.stringify(ok ? { access_token: "token-google-falso" } : {}), { status: ok ? 200 : 401 });
		}
		assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer token-google-falso");
		return sheets();
	}) as typeof fetch;
	console.log = (s: string) => logs.push(String(s));
	P.olvidar();
	return {
		llamadas,
		logs,
		restaurar: () => {
			globalThis.fetch = f;
			console.log = log;
			P.olvidar();
		},
	};
}
const hojaOk = () => new Response(JSON.stringify({ values: HOJA }), { status: 200 });

test("parsearFilas: solo @novodent.mx, activos y con perfil valido; banderas con los nombres de la hoja", () => {
	const m = P.parsearFilas(HOJA);
	assert.deepEqual([...m.keys()], ["ana@novodent.mx", "beto@novodent.mx", "cris@novodent.mx"]);
	assert.deepEqual(m.get("beto@novodent.mx"), { correo: "beto@novodent.mx", perfil: "Jefatura administrativa", registra_pagos: true, anula: true, escribe_evoluciones: false });
	assert.equal(m.get("cris@novodent.mx")?.escribe_evoluciones, true);
});

test("modo: vacio o apagado = apagado; sombra; cualquier otra cosa = activo (falla cerrado)", () => {
	assert.equal(P.modo({}), "apagado");
	assert.equal(P.modo({ PERFILES_MODO: "Apagado " }), "apagado");
	assert.equal(P.modo({ PERFILES_MODO: "sombra" }), "sombra");
	assert.equal(P.modo({ PERFILES_MODO: "activo" }), "activo");
	assert.equal(P.modo({ PERFILES_MODO: "sombraa" }), "activo");
});

test("la asercion para Google se firma con la cuenta de servicio y pide solo lectura de Sheets", async () => {
	const jwt = await P.firmarAsercion(sa, 1_700_000_000_000);
	const [h, c, s] = jwt.split(".");
	assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
	const claims = JSON.parse(Buffer.from(c, "base64url").toString());
	assert.equal(claims.iss, sa.client_email);
	assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets.readonly");
	assert.equal(claims.aud, sa.token_uri);
	assert.equal(claims.exp - claims.iat, 3600);
	assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url")));
});

test("activo: correo sin fila, inactivo, «Por confirmar» o sin correo → negar; perfil valido → pasa", async () => {
	const s = simular(hojaOk);
	try {
		const e = env("activo");
		assert.equal((await P.compuerta(e, "ana@novodent.mx", "agenda_dia")).negado, null);
		assert.equal((await P.compuerta(e, "ANA@novodent.mx", "agenda_dia")).negado, null);
		assert.match(((await P.compuerta(e, "nadie@novodent.mx", "agenda_dia")).negado) ?? "", /Sin permiso/);
		assert.match(((await P.compuerta(e, "eli@novodent.mx", "agenda_dia")).negado) ?? "", /Sin permiso/);
		assert.match(((await P.compuerta(e, "dani@novodent.mx", "agenda_dia")).negado) ?? "", /Sin permiso/);
		// Con perfil valido pero sin el grupo (matriz, fase 2) tambien se niega.
		assert.match(((await P.compuerta(e, "ana@novodent.mx", "crear_evolucion")).negado) ?? "", /tu perfil no puede/);
		assert.match(((await P.compuerta(e, "cris@novodent.mx", "registrar_pago")).negado) ?? "", /tu perfil no puede/);
		assert.equal((await P.compuerta(e, "cris@novodent.mx", "crear_evolucion")).negado, null);
		assert.equal((await P.compuerta(e, "beto@novodent.mx", "registrar_pago")).negado, null); // tiene la bandera
		assert.match(((await P.compuerta(e, "ana@novodent.mx", "registrar_pago")).negado) ?? "", /tu perfil puede, pero/); // sin bandera
		assert.match(((await P.compuerta(e, null, "agenda_dia")).negado) ?? "", /Sin permiso/);
		// La hoja se leyo una sola vez (cache de 5 min): un token y una lectura.
		assert.equal(s.llamadas.length, 2);
		const ultimo = JSON.parse(s.logs.at(-1)!);
		assert.deepEqual(ultimo, { evento: "herramienta", herramienta: "agenda_dia", correo: null, perfil: null, grupo: null, modo: "activo", resultado: "negado", motivo: "sin_correo" });
		const primero = JSON.parse(s.logs.find((l) => l.includes('"permitido"'))!);
		assert.equal(primero.perfil, "Atención a Clientes");
		assert.equal(primero.grupo, "agenda");
	} finally {
		s.restaurar();
	}
});

test("activo: hoja caida → «perfil no disponible», aunque el correo exista", async () => {
	const s = simular(() => new Response("error", { status: 500 }));
	try {
		const r = (await P.compuerta(env("activo"), "ana@novodent.mx", "agenda_dia")).negado;
		assert.match(r ?? "", /Perfil no disponible/);
		assert.ok(s.logs.some((l) => l.includes('"no_disponible"')));
	} finally {
		s.restaurar();
	}
});

test("activo: Google rechaza el token → negar", async () => {
	const s = simular(hojaOk);
	try {
		const e = env("activo");
		(e as any).GOOGLE_SA_JSON = JSON.stringify({ ...sa, private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) });
		assert.match(((await P.compuerta(e, "ana@novodent.mx", "agenda_dia")).negado) ?? "", /Perfil no disponible/);
	} finally {
		s.restaurar();
	}
});

test("sombra: registra lo que negaria (sin fila o por la matriz) pero deja pasar", async () => {
	const s = simular(hojaOk);
	try {
		assert.equal((await P.compuerta(env("sombra"), "nadie@novodent.mx", "huecos")).negado, null);
		let l = JSON.parse(s.logs.at(-1)!);
		assert.equal(l.resultado, "negaria");
		assert.equal(l.motivo, "sin_fila");
		assert.equal(l.modo, "sombra");
		// Jefatura administrativa sin la bandera registra_pagos: la matriz la negaria.
		assert.equal((await P.compuerta(env("sombra"), "beto@novodent.mx", "crear_evolucion")).negado, null);
		l = JSON.parse(s.logs.at(-1)!);
		assert.deepEqual([l.resultado, l.motivo, l.perfil], ["negaria", "perfil_sin_grupo", "Jefatura administrativa"]);
	} finally {
		s.restaurar();
	}
});

test("apagado: no lee la hoja y deja pasar", async () => {
	const s = simular(hojaOk);
	try {
		assert.equal((await P.compuerta(env("apagado"), "nadie@novodent.mx", "huecos")).negado, null);
		assert.equal(s.llamadas.length, 0);
		assert.equal(JSON.parse(s.logs.at(-1)!).resultado, "sin_filtro");
	} finally {
		s.restaurar();
	}
});

test("la cache vence a los 5 minutos y nada secreto va al log", async () => {
	const s = simular(hojaOk);
	const ttl = P.cache.ttlMs;
	try {
		P.cache.ttlMs = 0;
		(await P.compuerta(env("activo"), "ana@novodent.mx", "agenda_dia")).negado;
		(await P.compuerta(env("activo"), "ana@novodent.mx", "agenda_dia")).negado;
		assert.equal(s.llamadas.filter((u) => u.includes("sheets.googleapis.com")).length, 2);
		assert.equal(s.llamadas.filter((u) => u === sa.token_uri).length, 1); // el token si se reutiliza
		const todo = s.logs.join("\n");
		assert.ok(!todo.includes("token-google-falso") && !todo.includes("PRIVATE KEY") && !todo.includes("Nombre Falso"));
	} finally {
		P.cache.ttlMs = ttl;
		s.restaurar();
	}
});

test("appendFilas: pide un token con permiso de escritura y manda las filas tal cual", async () => {
	const s = simular(hojaOk);
	const f = globalThis.fetch;
	const llamadas: { url: string; body: any; auth: string }[] = [];
	globalThis.fetch = (async (u: URL | string, init?: RequestInit) => {
		const url = String(u);
		if (url === sa.token_uri) {
			const asercion = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
			const claims = JSON.parse(Buffer.from(asercion.split(".")[1], "base64url").toString());
			assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets");
			return new Response(JSON.stringify({ access_token: "token-escritura-falso" }), { status: 200 });
		}
		llamadas.push({ url, body: JSON.parse(String(init?.body)), auth: String((init?.headers as Record<string, string>).Authorization) });
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	try {
		await P.appendFilas({ GOOGLE_SA_JSON: JSON.stringify(sa), BITACORA_SHEET_ID: "hoja-bitacora" } as unknown as Env, [["a", null, "c"]]);
		assert.equal(llamadas.length, 1);
		assert.match(llamadas[0].url, /spreadsheets\/hoja-bitacora\/values\/BITACORA_CONSULTAS!A%3AJ:append\?valueInputOption=RAW/);
		assert.equal(llamadas[0].auth, "Bearer token-escritura-falso");
		assert.deepEqual(llamadas[0].body, { majorDimension: "ROWS", values: [["a", null, "c"]] });
	} finally {
		globalThis.fetch = f;
		s.restaurar();
	}
});
