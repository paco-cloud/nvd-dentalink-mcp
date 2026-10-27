/**
 * Bateria de NVD-TK-41 §4 (fase 5), en modo activo, contra la compuerta y el filtro
 * reales. Sheets y Dentalink simulados; cuentas y Files falsos (F-9001).
 *
 * Herramientas de pagos y de clinico todavia no existen: los casos 1, 3, 6 y 9 usan los
 * nombres que tendran (registrar_pago, crear_evolucion) o se comprueban en la matriz.
 * La corrida en vivo con cuentas de prueba va en docs/tk41-bateria-en-vivo.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import * as P from "../src/perfiles.ts";
import { matriz } from "../src/matriz.ts";
import { filtrar } from "../src/filtro.ts";
import { ritmo } from "../src/dentalink.ts";

ritmo.intervaloMs = 0;
const sa = {
	client_email: "sa-prueba@proyecto.iam.gserviceaccount.com",
	private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string,
	token_uri: "https://oauth2.example/token",
};
const env = { GOOGLE_SA_JSON: JSON.stringify(sa), PERFILES_SHEET_ID: "hoja", PERFILES_MODO: "activo", DENTALINK_BASE_URL: "https://dl.example/api/v1", LLAVE_DENTALINK: "t" } as unknown as Env;

// Una cuenta de prueba por perfil, como las de la fase 5.
const fila = (correo: string, perfil: string, pagos = "FALSE", activo = "TRUE") => [correo, "", "", "", pagos, "FALSE", "FALSE", activo, "", "", perfil, ""];
const HOJA = [
	fila("prueba.auxclinico@novodent.mx", "Auxiliar clínico"),
	fila("prueba.ac@novodent.mx", "Atención a Clientes"),
	fila("prueba.lab@novodent.mx", "Laboratorio"),
	fila("prueba.porconfirmar@novodent.mx", "Por confirmar"),
	fila("prueba.doctor@novodent.mx", "Doctor"),
	fila("prueba.direccion@novodent.mx", "Dirección"),
	fila("prueba.jefatura@novodent.mx", "Jefatura administrativa", "TRUE"),
	fila("prueba.jefatura2@novodent.mx", "Jefatura administrativa", "FALSE"),
];
const DENTISTAS = [
	{ id: 1, nombre: "A", apellidos: "", especialidad: "Ortodoncia", habilitado: 1 },
	{ id: 2, nombre: "B", apellidos: "", especialidad: "Odontología general", habilitado: 1 },
];

let hojaCaida = false;
function simular() {
	const f = globalThis.fetch;
	const log = console.log;
	console.log = () => {};
	globalThis.fetch = (async (u: URL | string) => {
		const url = String(u);
		if (url === sa.token_uri) return new Response(JSON.stringify({ access_token: "x" }), { status: 200 });
		if (url.includes("sheets.googleapis.com")) return hojaCaida ? new Response("", { status: 503 }) : new Response(JSON.stringify({ values: HOJA }), { status: 200 });
		return new Response(JSON.stringify({ data: DENTISTAS }), { status: 200 });
	}) as typeof fetch;
	P.olvidar();
	return () => {
		globalThis.fetch = f;
		console.log = log;
		P.olvidar();
	};
}

const negado = async (correo: string, h: string) => (await P.compuerta(env, correo, h)).negado;
const busqueda = () => ({ total: 1, pacientes: [{ file: "F-9001", alias: null, nombre: "Paciente Prueba", celular_termina_en: "1234" }] });
async function pasaYFiltra(correo: string, h: string, r: unknown) {
	const c = await P.compuerta(env, correo, h);
	assert.equal(c.negado, null, `${correo} · ${h} debía pasar`);
	return (await filtrar(env, c.perfil!, h, r)).resultado as any;
}

test("§4 casos 1 a 12 en modo activo", async () => {
	const restaurar = simular();
	try {
		// 1 · Auxiliar clínico pide pagos → negar (grupo «pagos» ausente; registrar_pago es la herramienta de pagos que existe en la matriz)
		assert.ok(!matriz.perfiles["Auxiliar clínico"].includes("pagos"));
		assert.match((await negado("prueba.auxclinico@novodent.mx", "registrar_pago")) ?? "", /Sin permiso/);
		// 2 · Auxiliar clínico busca paciente → sin celular
		assert.ok(!("celular_termina_en" in (await pasaYFiltra("prueba.auxclinico@novodent.mx", "buscar_paciente", busqueda())).pacientes[0]));
		// 3 · Atención a Clientes pide evoluciones → negar
		assert.ok(!matriz.perfiles["Atención a Clientes"].includes("clinico"));
		assert.match((await negado("prueba.ac@novodent.mx", "crear_evolucion")) ?? "", /Sin permiso/);
		// 4 · Atención a Clientes busca paciente → celular enmascarado (4 dígitos)
		assert.equal((await pasaYFiltra("prueba.ac@novodent.mx", "buscar_paciente", busqueda())).pacientes[0].celular_termina_en, "1234");
		// 5 · Laboratorio pide agenda_dia → sólo prótesis, ortodoncia y cirugía
		const agenda = { total: 2, citas: [{ id_profesional: 1 }, { id_profesional: 2 }] };
		assert.deepEqual((await pasaYFiltra("prueba.lab@novodent.mx", "agenda_dia", agenda)).citas, [{ id_profesional: 1 }]);
		// 6 · Laboratorio pide pagos → negar
		assert.ok(!matriz.perfiles.Laboratorio.includes("pagos"));
		assert.match((await negado("prueba.lab@novodent.mx", "registrar_pago")) ?? "", /Sin permiso/);
		// 7 · «Por confirmar» → negar todo
		for (const h of Object.keys(matriz.herramientas)) assert.match((await negado("prueba.porconfirmar@novodent.mx", h)) ?? "", /Sin permiso/, h);
		// 8 · Correo sin fila → negar todo
		for (const h of Object.keys(matriz.herramientas)) assert.match((await negado("nadie@novodent.mx", h)) ?? "", /Sin permiso/, h);
		// 9 · Doctor pide pagos → negar
		assert.ok(!matriz.perfiles.Doctor.includes("pagos"));
		assert.match((await negado("prueba.doctor@novodent.mx", "registrar_pago")) ?? "", /Sin permiso/);
		// 10 · Dirección: las 9 de lectura pasan; contacto enmascarado
		for (const h of ["agenda_dia", "citas_proximas", "confirmaciones_pendientes", "huecos", "dentistas", "buscar_paciente", "citas_paciente", "laboratorio_paciente", "laboratorios"]) {
			assert.equal(await negado("prueba.direccion@novodent.mx", h), null, h);
		}
		assert.equal((await pasaYFiltra("prueba.direccion@novodent.mx", "buscar_paciente", busqueda())).pacientes[0].celular_termina_en, "1234");
		// 12 · Jefatura registra pago sólo con puede_registrar_pagos
		assert.equal(await negado("prueba.jefatura@novodent.mx", "registrar_pago"), null);
		assert.match((await negado("prueba.jefatura2@novodent.mx", "registrar_pago")) ?? "", /le falta la autorización/);
		// 11 · Hoja caída → «perfil no disponible» (al final: vacía la cache)
		P.olvidar();
		hojaCaida = true;
		assert.match((await negado("prueba.direccion@novodent.mx", "agenda_dia")) ?? "", /Perfil no disponible/);
	} finally {
		hojaCaida = false;
		restaurar();
	}
});
