/**
 * Pruebas de NVD-TK-41 fase 6 (llave de Dentalink por dominio). Llaves falsas;
 * nada sale a Dentalink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { conLlave, llaveDe, LlaveNoDisponible } from "../src/llaves.ts";
import { matriz, validar } from "../src/matriz.ts";
import { ritmo } from "../src/dentalink.ts";
import * as T from "../src/tools.ts";

ritmo.intervaloMs = 0;
const base = { DENTALINK_BASE_URL: "https://dl.example/api/v1" };
const env = (o: Record<string, string> = {}) => ({ ...base, ...o }) as unknown as Env;
const TODAS = { DENTALINK_TOKEN_AGENDA: "llave-agenda", DENTALINK_TOKEN_CLINICO: "llave-clinico", DENTALINK_TOKEN_PAGOS: "llave-pagos" };

const AGENDA = ["agenda_dia", "citas_proximas", "confirmaciones_pendientes", "huecos", "dentistas", "buscar_paciente", "citas_paciente"];
const CLINICO = ["laboratorio_paciente", "laboratorios", "crear_evolucion"];

test("cada herramienta usa la llave de su dominio", () => {
	for (const h of AGENDA) assert.deepEqual(llaveDe(env(TODAS), h), { dominio: "agenda", origen: "dominio", token: "llave-agenda" }, h);
	for (const h of CLINICO) assert.deepEqual(llaveDe(env(TODAS), h), { dominio: "clinico", origen: "dominio", token: "llave-clinico" }, h);
	assert.deepEqual(llaveDe(env(TODAS), "registrar_pago"), { dominio: "pagos", origen: "dominio", token: "llave-pagos" });
	// Todas las herramientas de la matriz tienen dominio.
	assert.deepEqual(Object.keys(matriz.herramientas).sort(), [...AGENDA, ...CLINICO, "registrar_pago"].sort());
});

test("transición: sin la llave del dominio usa nvdasistentes mientras exista", () => {
	const e = env({ DENTALINK_TOKEN: "llave-vieja", DENTALINK_TOKEN_AGENDA: "llave-agenda" });
	assert.deepEqual(llaveDe(e, "agenda_dia"), { dominio: "agenda", origen: "dominio", token: "llave-agenda" });
	assert.deepEqual(llaveDe(e, "laboratorios"), { dominio: "clinico", origen: "respaldo", token: "llave-vieja" });
});

test("falla cerrado: sin llave del dominio ni respaldo, o herramienta desconocida, se niega", () => {
	assert.throws(() => llaveDe(env({ DENTALINK_TOKEN_AGENDA: "llave-agenda" }), "laboratorios"), LlaveNoDisponible);
	assert.throws(() => llaveDe(env({ DENTALINK_TOKEN_CLINICO: "  " }), "laboratorios"), LlaveNoDisponible);
	assert.throws(() => llaveDe(env(TODAS), "herramienta_que_no_existe"), LlaveNoDisponible);
	// El mensaje no trae ninguna llave.
	assert.ok(!new LlaveNoDisponible().message.includes("llave-"));
});

test("la consulta a Dentalink sale con la llave del dominio, no con la vieja", async () => {
	const vistos: string[] = [];
	const f = globalThis.fetch;
	globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
		vistos.push(String((init?.headers as Record<string, string>).Authorization));
		return new Response(JSON.stringify({ data: [] }), { status: 200 });
	}) as typeof fetch;
	try {
		const e = env({ DENTALINK_TOKEN: "llave-vieja", ...TODAS });
		await T.dentistas(conLlave(e, llaveDe(e, "dentistas")));
		await T.laboratorios(conLlave(e, llaveDe(e, "laboratorios")));
	} finally {
		globalThis.fetch = f;
	}
	assert.deepEqual(vistos, ["Token llave-agenda", "Token llave-clinico"]);
});

test("validar: un grupo sin llave o con llave desconocida no carga", () => {
	const clon = () => JSON.parse(JSON.stringify({ ...matriz, llaves: { ...matriz.llaves } }));
	let m = clon();
	delete m.llaves.agenda;
	assert.throws(() => validar(m), /no tiene llave/);
	m = clon();
	m.llaves.clinico = "todo";
	assert.throws(() => validar(m), /llave desconocida/);
});
