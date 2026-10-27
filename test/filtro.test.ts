/**
 * Pruebas de NVD-TK-41 fase 3 (filtro por campo y por fila). Dentalink se simula
 * solo para el catalogo de dentistas; datos falsos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrar, idsPorEspecialidad } from "../src/filtro.ts";
import { ritmo } from "../src/dentalink.ts";
import { PERFILES, type NombrePerfil, type Perfil } from "../src/perfil-tipos.ts";

ritmo.intervaloMs = 0;
const env = { DENTALINK_BASE_URL: "https://dl.example/api/v1", DENTALINK_TOKEN: "t" } as unknown as Env;
const p = (perfil: NombrePerfil): Perfil => ({ correo: "prueba@novodent.mx", perfil, registra_pagos: false, anula: false, escribe_evoluciones: false });

const DENTISTAS = [
	{ id: 1, nombre: "A", apellidos: "", especialidad: "Ortodoncia", habilitado: 1 },
	{ id: 2, nombre: "B", apellidos: "", especialidad: "Odontología general", habilitado: 1 },
	{ id: 3, nombre: "C", apellidos: "", especialidad: "Prótesis y rehabilitación", habilitado: 1 },
	{ id: 4, nombre: "D", apellidos: "", especialidad: "Cirugía maxilofacial", habilitado: 1 },
];

function conDentistas<T>(fn: () => Promise<T>): Promise<T> {
	const f = globalThis.fetch;
	globalThis.fetch = (async () => new Response(JSON.stringify({ data: DENTISTAS }), { status: 200 })) as typeof fetch;
	return fn().finally(() => (globalThis.fetch = f));
}

const busqueda = () => ({
	total: 2,
	pacientes: [
		{ file: "F-9001", alias: null, nombre: "Paciente Prueba", celular_termina_en: "1234" },
		{ file: "F-9002", alias: "PP", nombre: "Paciente Dos", celular_termina_en: "5678" },
	],
});

test("buscar_paciente: el celular enmascarado solo sale para quien tiene el grupo «contacto»", async () => {
	const conContacto: NombrePerfil[] = ["Dirección", "Jefatura administrativa", "Auxiliar administrativa", "Atención a Clientes"];
	for (const perfil of PERFILES) {
		const f = await filtrar(env, p(perfil), "buscar_paciente", busqueda());
		const tiene = (f.resultado as any).pacientes.every((x: any) => "celular_termina_en" in x);
		assert.equal(tiene, conContacto.includes(perfil), perfil);
		assert.deepEqual(f.quitado, conContacto.includes(perfil) ? [] : ["celular_termina_en"]);
		// El resto de la lista blanca se conserva.
		assert.deepEqual(Object.keys((f.resultado as any).pacientes[0]).filter((k) => k !== "celular_termina_en"), ["file", "alias", "nombre"]);
	}
});

test("Laboratorio: en la agenda solo ve profesionales de prótesis, ortodoncia y cirugía", async () => {
	const citas = () => ({
		fecha: "2026-10-27",
		total: 4,
		citas: [1, 2, 3, 4].map((id) => ({ fecha: "2026-10-27", hora: "10:00", profesional: `Dr ${id}`, id_profesional: id, estado: "Agendada", paciente: "X", file: "F-9001", id_cita: id })),
	});
	await conDentistas(async () => {
		for (const h of ["agenda_dia", "citas_proximas", "confirmaciones_pendientes"]) {
			const f = await filtrar(env, p("Laboratorio"), h, citas());
			const r = f.resultado as any;
			assert.deepEqual(r.citas.map((c: any) => c.id_profesional), [1, 3, 4], h);
			assert.equal(r.total, 3);
			assert.deepEqual(f.quitado, ["citas_otra_especialidad:1"]);
		}
		const hu = await filtrar(env, p("Laboratorio"), "huecos", { fecha: "x", total: 2, huecos: [{ id_profesional: 2 }, { id_profesional: 3 }] });
		assert.deepEqual((hu.resultado as any).huecos, [{ id_profesional: 3 }]);
		// dentistas se filtra sobre su propia lista, sin llamar a Dentalink otra vez.
		const d = await filtrar(env, p("Laboratorio"), "dentistas", { dentistas: DENTISTAS.map(({ id, especialidad }) => ({ id, nombre: "n", especialidad, habilitado: 1 })) });
		assert.deepEqual((d.resultado as any).dentistas.map((x: any) => x.id), [1, 3, 4]);
		assert.deepEqual(d.quitado, ["dentistas_otra_especialidad:1"]);
		// Los demás perfiles ven la agenda completa.
		for (const perfil of PERFILES.filter((x) => x !== "Laboratorio")) {
			const f = await filtrar(env, p(perfil), "agenda_dia", citas());
			assert.equal((f.resultado as any).citas.length, 4, perfil);
			assert.deepEqual(f.quitado, []);
		}
	});
});

test("idsPorEspecialidad: sin acentos ni mayúsculas, por contención", () => {
	assert.deepEqual([...idsPorEspecialidad(DENTISTAS, ["protesis", "ORTODONCIA", "cirugía"])], [1, 3, 4]);
	assert.deepEqual([...idsPorEspecialidad(DENTISTAS, ["endodoncia"])], []);
});

test("el filtro no toca lo que no está en la matriz y nunca registra valores", async () => {
	const lab = { file: "F-9001", planes_activos: [{ plan: "Plan", prestaciones: [{ prestacion: "Corona" }] }] };
	for (const perfil of PERFILES) {
		const f = await filtrar(env, p(perfil), "laboratorio_paciente", structuredClone(lab));
		assert.deepEqual(f.resultado, lab, perfil);
		assert.deepEqual(f.quitado, []);
	}
	const f = await filtrar(env, p("Doctor"), "buscar_paciente", busqueda());
	assert.ok(!JSON.stringify(f.quitado).includes("1234"));
});
