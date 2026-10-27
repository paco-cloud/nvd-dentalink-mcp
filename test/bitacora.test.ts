/**
 * Pruebas de NVD-TK-41 fase 4 (bitacora de consultas). KV y Sheets simulados;
 * datos falsos. Nada sale a Cloudflare ni a Google.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "../src/bitacora.ts";

/** KV minimo: put/get/list con prefijo y expirationTtl guardado para comprobarlo. */
function fakeKV() {
	const datos = new Map<string, { v: string; ttl?: number }>();
	let fallaPut = false;
	const kv = {
		put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
			if (fallaPut) throw new Error("kv caido");
			datos.set(k, { v, ttl: o?.expirationTtl });
		},
		get: async (k: string) => datos.get(k)?.v ?? null,
		list: async (o: { prefix?: string; cursor?: string }) => ({
			keys: [...datos.keys()]
				.filter((k) => k.startsWith(o.prefix ?? ""))
				.sort()
				.map((name) => ({ name })),
			list_complete: true as const,
			cursor: undefined,
		}),
		datos,
		romper: () => (fallaPut = true),
	};
	return kv;
}

const entrada = (o: Partial<B.Entrada> = {}): B.Entrada => ({
	fecha_hora_mx: "2026-10-25 10:15:00.000",
	correo: "ana@novodent.mx",
	perfil: "Atención a Clientes",
	herramienta: "citas_paciente",
	file: "F-9001",
	resultado: "permitido",
	modo: "sombra",
	motivo: null,
	quitado: [],
	...o,
});

test("fileDe: solo el File normalizado, nunca otro argumento", () => {
	assert.equal(B.fileDe("F-9001"), "F-9001");
	assert.equal(B.fileDe(" 9001 "), "F-9001");
	assert.equal(B.fileDe("Paciente Prueba"), null);
	assert.equal(B.fileDe(undefined), null);
});

test("registrar: guarda con 90 dias, bajo el dia, y solo los campos de la bitacora", async () => {
	const kv = fakeKV();
	const env = { BITACORA: kv } as unknown as Env;
	await B.registrar(env, entrada());
	await B.registrar(env, entrada({ fecha_hora_mx: "2026-10-26 09:00:00.000", resultado: "negado", motivo: "sin_fila" }));
	assert.equal(kv.datos.size, 2);
	for (const [k, { v, ttl }] of kv.datos) {
		assert.match(k, /^consulta\/2026-10-2[56]\/\d\d:\d\d:\d\d\.\d{3}\/[0-9a-f]{8}$/);
		assert.equal(ttl, 90 * 24 * 3600);
		assert.deepEqual(Object.keys(JSON.parse(v)), ["fecha_hora_mx", "correo", "perfil", "herramienta", "file", "resultado", "modo", "motivo", "quitado"]);
	}
	assert.deepEqual((await B.entradasDe(env, "2026-10-25")).map((e) => e.resultado), ["permitido"]);
	assert.deepEqual((await B.entradasDe(env, "2026-10-26")).map((e) => e.resultado), ["negado"]);
});

test("registrar: si el KV falla, no lanza (la respuesta sigue) y lo dice el log", async () => {
	const kv = fakeKV();
	kv.romper();
	const logs: string[] = [];
	const log = console.log;
	console.log = (s: string) => logs.push(String(s));
	try {
		await B.registrar({ BITACORA: kv } as unknown as Env, entrada());
		assert.ok(logs.some((l) => l.includes('"no_guardada"')));
	} finally {
		console.log = log;
	}
});

test("exportar: manda las filas de ayer en el orden de los encabezados y marca el dia", async () => {
	const kv = fakeKV();
	const env = { BITACORA: kv, BITACORA_SHEET_ID: "hoja-falsa" } as unknown as Env;
	await B.registrar(env, entrada({ fecha_hora_mx: "2026-10-25 08:00:00.000" }));
	await B.registrar(env, entrada({ fecha_hora_mx: "2026-10-25 09:30:00.000", herramienta: "buscar_paciente", file: null, resultado: "filtraria", quitado: ["celular_termina_en"] }));
	await B.registrar(env, entrada({ fecha_hora_mx: "2026-10-26 08:00:00.000" })); // hoy: no se exporta
	const enviadas: (string | null)[][][] = [];
	const r = await B.exportar(env, async (_e, filas) => void enviadas.push(filas), "2026-10-25");
	assert.deepEqual(r, { dia: "2026-10-25", filas: 2, exportado: true });
	assert.equal(enviadas.length, 1);
	const [f1, f2] = enviadas[0];
	assert.deepEqual(f1.slice(0, 9), ["2026-10-25 08:00:00.000", "ana@novodent.mx", "Atención a Clientes", "citas_paciente", "F-9001", "permitido", "sombra", null, ""]);
	assert.deepEqual(f2.slice(3, 9), ["buscar_paciente", null, "filtraria", "sombra", null, "celular_termina_en"]);
	assert.match(String(f1[9]), /^\d{4}-\d\d-\d\d \d\d:\d\d/); // cuando se exporto
	// Segunda corrida del mismo dia: no duplica.
	const r2 = await B.exportar(env, async () => assert.fail("no debe volver a mandar"), "2026-10-25");
	assert.deepEqual(r2, { dia: "2026-10-25", filas: 0, exportado: true });
});

test("exportar: si la hoja falla, no marca el dia y se reintenta", async () => {
	const kv = fakeKV();
	const env = { BITACORA: kv, BITACORA_SHEET_ID: "hoja-falsa" } as unknown as Env;
	await B.registrar(env, entrada({ fecha_hora_mx: "2026-10-25 08:00:00.000" }));
	await assert.rejects(
		B.exportar(env, async () => {
			throw new Error("Sheets append: 403");
		}, "2026-10-25"),
	);
	assert.equal(await kv.get("exportado/2026-10-25"), null);
	let filas = 0;
	await B.exportar(env, async (_e, f) => void (filas = f.length), "2026-10-25");
	assert.equal(filas, 1);
});

test("exportar: sin KV o sin hoja no hace nada; un dia sin entradas se marca sin mandar", async () => {
	assert.deepEqual(await B.exportar({} as Env, async () => assert.fail("no"), "2026-10-25"), { dia: "2026-10-25", filas: 0, exportado: false });
	const kv = fakeKV();
	const env = { BITACORA: kv, BITACORA_SHEET_ID: "hoja-falsa" } as unknown as Env;
	let llamadas = 0;
	assert.deepEqual(await B.exportar(env, async () => void llamadas++, "2026-10-24"), { dia: "2026-10-24", filas: 0, exportado: true });
	assert.equal(llamadas, 0);
	assert.ok(await kv.get("exportado/2026-10-24"));
});
