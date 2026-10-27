import { test } from "node:test";
import assert from "node:assert/strict";
import { ritmo } from "../src/dentalink.ts";
import * as T from "../src/tools.ts";

ritmo.intervaloMs = 0;
ritmo.espera429Ms = 0;

const env = { DENTALINK_BASE_URL: "https://dl.example/api/v1", LLAVE_DENTALINK: "t" } as unknown as Env;

// Campos que nunca deben salir, aunque Dentalink los mande.
const PROHIBIDOS = ["comentarios", "comentario", "diagnostico", "evolucion", "monto", "precio", "celular", "email", "rut"];

type Ruta = (url: URL) => unknown;
function conDentalink(rutas: Record<string, Ruta>, fn: (calls: { url: URL; method: string }[]) => Promise<void>) {
	return async () => {
		const calls: { url: URL; method: string }[] = [];
		const orig = globalThis.fetch;
		globalThis.fetch = (async (u: URL, init: RequestInit) => {
			const url = new URL(String(u));
			calls.push({ url, method: init?.method ?? "GET" });
			const key = url.pathname.replace("/api/v1/", "");
			const r = rutas[key];
			if (!r) return new Response("no", { status: 404 });
			return new Response(JSON.stringify(r(url)), { status: 200 });
		}) as typeof fetch;
		try {
			await fn(calls);
			assert.ok(calls.every((c) => c.method === "GET"), "solo GET");
			assert.ok(calls.every((c) => c.url.origin === "https://dl.example"), "solo Dentalink");
		} finally {
			globalThis.fetch = orig;
		}
	};
}

function sinProhibidos(obj: unknown) {
	const txt = JSON.stringify(obj);
	for (const k of PROHIBIDOS) assert.ok(!txt.includes(`"${k}"`), `no debe salir ${k}`);
	assert.ok(!/\d{7,}/.test(txt.replace(/"\d{4}-\d{2}-\d{2}"/g, "")), "ningun numero largo (celular completo)");
}

const hoy = T.hoyMx();
const baseCita = {
	fecha: hoy, hora_inicio: "10:30:00", duracion: 30, nombre_dentista: "Dra. Wendy", nombre_sillon: "Sillón 1",
	id_paciente: 77, nombre_paciente: "Ana López", nombre_social_paciente: "", id_sucursal: 1, id_dentista: 5,
	comentarios: "dolor molar", monto: 1500, celular: "7221234567",
};

test(
	"agenda_dia: filtra sucursal y anuladas, ordena, lista blanca",
	conDentalink(
		{
			citas: (u) => {
				assert.deepEqual(JSON.parse(u.searchParams.get("q")!), { fecha: { eq: hoy } });
				return {
					data: [
						{ ...baseCita, id: 2, id_estado: 7, hora_inicio: "12:00:00" },
						{ ...baseCita, id: 1, id_estado: 3 },
						{ ...baseCita, id: 3, id_estado: 1 }, // cancelada
						{ ...baseCita, id: 4, id_estado: 3, id_sucursal: 2 }, // otra sucursal
					],
				};
			},
		},
		async () => {
			const r = await T.agenda_dia(env, {});
			assert.equal(r.total, 2);
			assert.deepEqual(r.citas.map((c) => c.id_cita), [1, 2]);
			assert.deepEqual(r.citas[0], {
				fecha: hoy, hora: "10:30", duracion: 30, profesional: "Dra. Wendy", id_profesional: 5, consultorio: "Sillón 1",
				estado: "Confirmada", paciente: "Ana López", file: "F-77", id_cita: 1,
			});
			sinProhibidos(r);
		},
	),
);

test(
	"confirmaciones_pendientes: solo sin confirmar, rango por defecto 2 dias",
	conDentalink(
		{
			citas: (u) => {
				assert.deepEqual(JSON.parse(u.searchParams.get("q")!), { fecha: [{ gte: hoy }, { lte: T.hoyMx(2) }] });
				return { data: [{ ...baseCita, id: 1, id_estado: 7 }, { ...baseCita, id: 2, id_estado: 3 }] };
			},
		},
		async () => {
			const r = await T.confirmaciones_pendientes(env, {});
			assert.deepEqual(r.citas.map((c) => c.id_cita), [1]);
			sinProhibidos(r);
		},
	),
);

test(
	"citas_proximas: filtra por profesional",
	conDentalink(
		{
			citas: (u) => {
				assert.deepEqual(JSON.parse(u.searchParams.get("q")!).id_dentista, { eq: 5 });
				return { data: [{ ...baseCita, id: 1, id_estado: 3 }, { ...baseCita, id: 2, id_estado: 3, id_dentista: 9 }] };
			},
		},
		async () => {
			const r = await T.citas_proximas(env, { dias: 3, id_dentista: 5 });
			assert.deepEqual(r.citas.map((c) => c.id_cita), [1]);
		},
	),
);

test(
	"buscar_paciente: celular solo ultimos 4, filtra apellido, maximo 5",
	conDentalink(
		{
			pacientes: (u) => {
				assert.deepEqual(JSON.parse(u.searchParams.get("q")!), { nombre: { lk: "Ana" } });
				return {
					data: Array.from({ length: 8 }, (_, i) => ({
						id: 100 + i, nombre: "Ana", apellidos: i < 6 ? "López Ruiz" : "Pérez", nombre_social: "",
						celular: "+52 722 123 45" + String(i).padStart(2, "0"), email: "a@b.mx", rut: "X",
					})),
				};
			},
		},
		async () => {
			const r = await T.buscar_paciente(env, { texto: "Ana López" });
			assert.equal(r.total, 6);
			assert.equal(r.pacientes.length, 5);
			assert.deepEqual(r.pacientes[0], { file: "F-100", alias: null, nombre: "Ana López Ruiz", celular_termina_en: "4500" });
			sinProhibidos(r);
		},
	),
);

test(
	"buscar_paciente: por celular usa los ultimos 8 digitos",
	conDentalink(
		{
			pacientes: (u) => {
				assert.deepEqual(JSON.parse(u.searchParams.get("q")!), { celular: { lk: "21234567" } });
				return { data: [] };
			},
		},
		async () => {
			await T.buscar_paciente(env, { texto: "722 123 4567" });
		},
	),
);

test("buscar_paciente y citas_paciente rechazan entradas vacias", async () => {
	await assert.rejects(T.buscar_paciente(env, { texto: "ab" }), T.UsoError);
	await assert.rejects(T.citas_paciente(env, { file: "F-" }), T.UsoError);
});

test(
	"citas_paciente: proximas sin anuladas y ultimas",
	conDentalink(
		{
			"pacientes/77/citas": () => ({
				data: [
					{ ...baseCita, id: 1, fecha: T.hoyMx(3), id_estado: 7 },
					{ ...baseCita, id: 2, fecha: T.hoyMx(1), id_estado: 1 },
					{ ...baseCita, id: 3, fecha: T.hoyMx(-10), id_estado: 2 },
				],
			}),
		},
		async () => {
			const r = await T.citas_paciente(env, { file: "F-77" });
			assert.deepEqual(r.proximas.map((c) => c.id_cita), [1]);
			assert.deepEqual(r.ultimas.map((c) => c.id_cita), [3]);
			sinProhibidos(r);
		},
	),
);

test(
	"huecos: sucursal 1, manana por defecto, 30 min",
	conDentalink(
		{
			"agendas/": (u) => {
				assert.deepEqual(JSON.parse(u.searchParams.get("q")!), { id_sucursal: 1, fecha: T.hoyMx(1), duracion: 30 });
				return { data: [{ fecha: T.hoyMx(1), hora_inicio: "09:00", nombre_dentista: "Dra. Wendy", id_dentista: 5, id_recurso: 2, precio: 1 }] };
			},
		},
		async () => {
			const r = await T.huecos(env, {});
			assert.deepEqual(r.huecos, [{ fecha: T.hoyMx(1), hora: "09:00", profesional: "Dra. Wendy", id_profesional: 5, consultorio: 2 }]);
		},
	),
);

test(
	"dentistas y laboratorios: catalogos con lista blanca",
	conDentalink(
		{
			dentistas: () => ({ data: [{ id: 5, nombre: "Wendy", apellidos: "Ruiz", especialidad: "Ortodoncia", habilitado: 1, email: "w@x.mx", celular: "7221234567" }] }),
			laboratorios: () => ({ data: [{ id: 1, nombre: "Lab A", habilitado: 1, email: "l@x.mx" }] }),
		},
		async () => {
			const d = await T.dentistas(env);
			assert.deepEqual(d.dentistas, [{ id: 5, nombre: "Wendy Ruiz", especialidad: "Ortodoncia", habilitado: 1 }]);
			const l = await T.laboratorios(env);
			assert.deepEqual(l.laboratorios, [{ id: 1, nombre: "Lab A", habilitado: 1 }]);
			sinProhibidos([d, l]);
		},
	),
);

test(
	"laboratorio_paciente: planes activos, prestaciones anidadas, sin montos",
	conDentalink(
		{
			"pacientes/77/tratamientos": () => ({
				data: [
					{ id: 10, nombre: "Prótesis", fecha: "2026-09-01", nombre_dentista: "Dr. Santiago", finalizado: 0, total: 9000 },
					{ id: 11, nombre: "Viejo", finalizado: 1 },
					{ id: 12, nombre: "Roto", finalizado: 0 },
				],
			}),
			"tratamientos/10/desgloce-por-seccion": () => ({
				data: {
					secciones: [
						{
							nombre: "Superior",
							items: [
								{ nombre_prestacion: "Corona", nombre_tipo_prestacion: "Prótesis", estado_prestacion: "En proceso", nombre_estado_solicitud_laboratorio: "Enviada", monto: 4500, comentario: "x" },
								{ nombre_prestacion: "Limpieza", estado_prestacion: "Terminada" },
							],
						},
					],
				},
			}),
		},
		async () => {
			const r = await T.laboratorio_paciente(env, { file: "77" });
			assert.equal(r.planes_activos.length, 2);
			assert.deepEqual(r.planes_activos[0], {
				plan: "Prótesis", fecha: "2026-09-01", profesional: "Dr. Santiago",
				prestaciones: [{ prestacion: "Corona", tipo: "Prótesis", estado_prestacion: "En proceso", solicitud_laboratorio: "Enviada" }],
			});
			assert.deepEqual(r.planes_activos[1], { plan: "Roto", error: "Dentalink no devolvió el desglose de este plan" });
			assert.ok(!JSON.stringify(r).includes("9000") && !JSON.stringify(r).includes("4500"), "sin montos");
			sinProhibidos(r);
		},
	),
);

test("dentalink: reintenta en 429 y luego responde", async () => {
	let n = 0;
	const orig = globalThis.fetch;
	globalThis.fetch = (async () => (++n < 3 ? new Response("", { status: 429 }) : new Response(JSON.stringify({ data: [{ id: 1, nombre: "L" }] })))) as unknown as typeof fetch;
	try {
		const r = await T.laboratorios(env);
		assert.equal(n, 3);
		assert.equal(r.laboratorios.length, 1);
	} finally {
		globalThis.fetch = orig;
	}
});
