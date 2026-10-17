import { test } from "node:test";
import assert from "node:assert/strict";
import { esAtrasada, filtrarTareas, tarea, TIPOS } from "../src/tareas.ts";
import { UsoError } from "../src/tools.ts";

const HOY = "2026-10-17";

// Filas inventadas con la forma que se espera de Dentalink. Ningun dato real.
const fila = (extra: Record<string, unknown> = {}) => ({
	id: 501,
	id_paciente: 1234,
	nombre_tipo: "Cobranza",
	fecha_creacion: "2026-09-01",
	fecha_vencimiento: "2026-10-10",
	nombre_usuario: "Andres",
	estado: "Abierta",
	...extra,
});

test("la lista blanca deja fuera nombre, asunto y notas", () => {
	const t = tarea(fila({ nombre_paciente: "X", asunto: "Y", notas: "Z", telefono: "722" }));
	assert.deepEqual(Object.keys(t).sort(), ["creada", "estado", "file", "id_tarea", "responsable", "tipo", "vence"]);
	assert.equal(t.file, "F-1234");
	// Lo prohibido no aparece, ni siquiera como undefined.
	for (const prohibido of ["nombre_paciente", "asunto", "notas", "telefono"]) {
		assert.equal(Object.hasOwn(t, prohibido), false, `${prohibido} no debe salir`);
	}
});

test("una tarea sin paciente sale con file nulo, no con F-undefined", () => {
	assert.equal(tarea(fila({ id_paciente: null })).file, null);
});

test("atrasada es la que vencio y sigue abierta", () => {
	assert.equal(esAtrasada(fila(), HOY), true);
	assert.equal(esAtrasada(fila({ fecha_vencimiento: HOY }), HOY), false, "vence hoy no esta atrasada");
	assert.equal(esAtrasada(fila({ fecha_vencimiento: "2026-11-01" }), HOY), false);
	assert.equal(esAtrasada(fila({ estado: "Cerrada" }), HOY), false);
	assert.equal(esAtrasada(fila({ estado: "COMPLETADA" }), HOY), false);
	assert.equal(esAtrasada(fila({ fecha_vencimiento: "" }), HOY), false);
});

test("filtra por tipo y por responsable, sin importar mayusculas", () => {
	const filas = [
		fila({ id: 1, nombre_tipo: "Cobranza", nombre_usuario: "Andres" }),
		fila({ id: 2, nombre_tipo: "Control", nombre_usuario: "Maitte" }),
		fila({ id: 3, nombre_tipo: "Cobranza", nombre_usuario: "Maitte" }),
	];
	assert.deepEqual(filtrarTareas(filas, { tipo: "cobranza", hoy: HOY }).map((t) => t.id), [1, 3]);
	assert.deepEqual(filtrarTareas(filas, { responsable: " maitte ", hoy: HOY }).map((t) => t.id), [2, 3]);
	assert.deepEqual(filtrarTareas(filas, { tipo: "Cobranza", responsable: "Maitte", hoy: HOY }).map((t) => t.id), [3]);
	assert.equal(filtrarTareas(filas, { hoy: HOY }).length, 3);
});

test("un tipo que no existe se rechaza con un mensaje util", () => {
	assert.throws(() => filtrarTareas([], { tipo: "Urgente" }), UsoError);
	assert.equal(TIPOS.length, 5);
});

test("ordena por fecha de vencimiento, lo mas viejo primero", () => {
	const filas = [
		fila({ id: 1, fecha_vencimiento: "2026-10-10" }),
		fila({ id: 2, fecha_vencimiento: "2026-08-15" }),
		fila({ id: 3, fecha_vencimiento: "2026-09-30" }),
	];
	assert.deepEqual(filtrarTareas(filas, { hoy: HOY }).map((t) => t.id), [2, 3, 1]);
});
