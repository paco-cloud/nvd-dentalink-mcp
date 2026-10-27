/**
 * Pruebas de NVD-TK-41 fase 2 (matriz por herramienta). Perfiles falsos; nada
 * sale a Dentalink ni a Sheets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matriz, permite, validar } from "../src/matriz.ts";
import { PERFILES, type NombrePerfil, type Perfil } from "../src/perfil-tipos.ts";

const p = (perfil: NombrePerfil, b: Partial<Pick<Perfil, "registra_pagos" | "anula" | "escribe_evoluciones">> = {}): Perfil => ({
	correo: "prueba@novodent.mx",
	perfil,
	registra_pagos: false,
	anula: false,
	escribe_evoluciones: false,
	...b,
});

const LECTURA = ["agenda_dia", "citas_proximas", "confirmaciones_pendientes", "huecos", "dentistas", "buscar_paciente", "citas_paciente", "laboratorio_paciente", "laboratorios"];

// Tabla de NVD-TK-41 §2 para las 9 herramientas que existen hoy: ✔ = pasa.
const ESPERADO: Record<NombrePerfil, string[]> = {
	Dirección: LECTURA,
	"Jefatura administrativa": LECTURA,
	"Auxiliar administrativa": LECTURA.filter((h) => !h.startsWith("laboratorio")),
	"Atención a Clientes": LECTURA,
	Doctor: LECTURA,
	"Auxiliar clínico": LECTURA,
	Laboratorio: LECTURA,
};

test("matriz: los 7 perfiles contra las 9 herramientas de lectura (NVD-TK-41 §2)", () => {
	for (const perfil of PERFILES) {
		for (const h of LECTURA) {
			const v = permite(p(perfil), h);
			assert.equal(v.ok, ESPERADO[perfil].includes(h), `${perfil} · ${h}`);
		}
	}
});

test("matriz: herramienta desconocida se niega para todos", () => {
	for (const perfil of PERFILES) {
		const v = permite(p(perfil), "herramienta_que_no_existe");
		assert.deepEqual(v, { ok: false, motivo: "herramienta_desconocida", grupo: null });
	}
});

test("matriz: registrar_pago exige el grupo y la bandera registra_pagos", () => {
	assert.equal(permite(p("Jefatura administrativa"), "registrar_pago").ok, false);
	assert.equal((permite(p("Jefatura administrativa"), "registrar_pago") as any).motivo, "sin_bandera");
	assert.equal(permite(p("Jefatura administrativa", { registra_pagos: true }), "registrar_pago").ok, true);
	// Doctor no tiene el grupo: la bandera sola no alcanza.
	assert.equal((permite(p("Doctor", { registra_pagos: true }), "registrar_pago") as any).motivo, "perfil_sin_grupo");
});

test("matriz: crear_evolucion solo Doctor y Auxiliar clínico con escribe_evoluciones", () => {
	assert.equal(permite(p("Doctor", { escribe_evoluciones: true }), "crear_evolucion").ok, true);
	assert.equal(permite(p("Auxiliar clínico", { escribe_evoluciones: true }), "crear_evolucion").ok, true);
	assert.equal(permite(p("Doctor"), "crear_evolucion").ok, false);
	assert.equal(permite(p("Atención a Clientes", { escribe_evoluciones: true }), "crear_evolucion").ok, false);
	assert.equal(permite(p("Dirección", { escribe_evoluciones: true }), "crear_evolucion").ok, false);
});

test("matriz: pagos y clínico (lectura) según §2, aunque todavía no haya herramientas", () => {
	const pagos = (perfil: NombrePerfil) => matriz.perfiles[perfil].includes("pagos");
	const clinico = (perfil: NombrePerfil) => matriz.perfiles[perfil].includes("clinico");
	const contacto = (perfil: NombrePerfil) => matriz.perfiles[perfil].includes("contacto");
	assert.deepEqual(PERFILES.filter(pagos), ["Dirección", "Jefatura administrativa", "Auxiliar administrativa", "Atención a Clientes"]);
	assert.deepEqual(PERFILES.filter(clinico), ["Dirección", "Doctor", "Auxiliar clínico"]);
	assert.deepEqual(PERFILES.filter(contacto), ["Dirección", "Jefatura administrativa", "Auxiliar administrativa", "Atención a Clientes"]);
});

test("validar: un JSON mal hecho no carga (falla cerrado en el deploy)", () => {
	assert.ok(validar(matriz).version.length > 0);
	const clon = () => JSON.parse(JSON.stringify(matriz));
	let m = clon();
	m.herramientas.huecos.grupo = "grupo_inventado";
	assert.throws(() => validar(m), /grupo desconocido/);
	m = clon();
	delete m.perfiles.Doctor;
	assert.throws(() => validar(m), /falta el perfil Doctor/);
	m = clon();
	m.perfiles["Por confirmar"] = ["agenda"];
	assert.throws(() => validar(m), /perfil desconocido/);
	m = clon();
	m.herramientas.registrar_pago.bandera = "puede_todo";
	assert.throws(() => validar(m), /bandera desconocida/);
});
