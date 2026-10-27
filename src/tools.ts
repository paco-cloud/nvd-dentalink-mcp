/**
 * Las 9 herramientas, portadas de nvd-mcp.js. Logica pura (sin MCP) para poder
 * probarla en Node.
 *
 * Lista blanca: cada respuesta se arma campo por campo; nada de Dentalink sale
 * tal cual. Nunca: evoluciones, diagnosticos, comentarios clinicos, montos ni
 * el celular completo.
 */
import { dentalinkGet, dentalinkOne, q, ultimos4, type Row } from "./dentalink.ts";

const SUCURSAL = 1;
const MAX = 25;

const ESTADO: Record<number, string> = {
	7: "Agendada", 12: "Agendada", 13: "Agendada", 15: "Agendada",
	3: "Confirmada", 11: "Confirmada", 17: "Confirmada", 20: "Confirmada",
	5: "Llegó", 6: "En atención", 2: "Terminó", 8: "No asistió", 14: "Reprogramada", 16: "Reprogramada",
	1: "Cancelada", 9: "Cancelada", 10: "Cancelada", 18: "Cancelada", 19: "Cancelada", 21: "Cancelada",
};
const SIN_CONFIRMAR = new Set([7, 12, 13, 15]);
const ANULADA = new Set([1, 9, 10, 14, 16, 18, 19, 21]);

/** Error con un mensaje que si se puede mostrar a quien pregunta. */
export class UsoError extends Error {}

/** Fecha en Mexico (UTC-6, sin horario de verano desde 2022). */
export const hoyMx = (d = 0, ahora = Date.now()) => new Date(ahora - 6 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);

const alias = (c: Row) => String(c.nombre_social_paciente ?? "").trim() || String(c.nombre_paciente ?? "").trim();

export const cita = (c: Row) => ({
	fecha: c.fecha,
	hora: String(c.hora_inicio ?? "").slice(0, 5),
	duracion: c.duracion,
	profesional: c.nombre_dentista,
	id_profesional: c.id_dentista,
	consultorio: c.nombre_sillon,
	estado: ESTADO[c.id_estado] ?? c.estado_cita,
	paciente: alias(c),
	file: `F-${c.id_paciente}`,
	id_cita: c.id,
});

function idDeFile(file: unknown): string {
	const id = String(file ?? "").replace(/\D/g, "");
	if (!id) throw new UsoError("Indica el File del paciente (F-1234).");
	return id;
}

const rango = (n: unknown, def: number, min: number, max: number) => Math.min(Math.max(Number(n) || def, min), max);

async function citasRango(env: Env, desde: string, hasta: string, idDentista?: number): Promise<Row[]> {
	const filtro: Row = desde === hasta ? { fecha: { eq: desde } } : { fecha: [{ gte: desde }, { lte: hasta }] };
	if (idDentista) filtro.id_dentista = { eq: Number(idDentista) };
	const filas = await dentalinkGet(env, "citas", q(filtro), 12);
	return filas
		.filter((c) => c.id_sucursal === SUCURSAL && c.fecha >= desde && c.fecha <= hasta && (!idDentista || c.id_dentista === Number(idDentista)))
		.sort((a, b) => String(a.fecha + a.hora_inicio).localeCompare(String(b.fecha + b.hora_inicio)));
}

export async function agenda_dia(env: Env, a: { fecha?: string; id_dentista?: number }) {
	const f = a.fecha || hoyMx();
	const c = (await citasRango(env, f, f, a.id_dentista)).filter((x) => !ANULADA.has(x.id_estado));
	return { fecha: f, total: c.length, citas: c.slice(0, 60).map(cita) };
}

export async function confirmaciones_pendientes(env: Env, a: { dias?: number }) {
	const d = rango(a.dias, 2, 1, 7);
	const c = (await citasRango(env, hoyMx(0), hoyMx(d))).filter((x) => SIN_CONFIRMAR.has(x.id_estado));
	return { desde: hoyMx(0), hasta: hoyMx(d), total: c.length, citas: c.slice(0, MAX * 2).map(cita) };
}

export async function citas_proximas(env: Env, a: { dias?: number; id_dentista?: number }) {
	const d = rango(a.dias, 3, 1, 7);
	const c = (await citasRango(env, hoyMx(0), hoyMx(d), a.id_dentista)).filter((x) => !ANULADA.has(x.id_estado));
	return { desde: hoyMx(0), hasta: hoyMx(d), total: c.length, citas: c.slice(0, 80).map(cita) };
}

export async function buscar_paciente(env: Env, a: { texto: string }) {
	const t = String(a.texto ?? "").trim();
	if (t.length < 3) throw new UsoError("Escribe al menos 3 letras o dígitos.");
	const palabras = t.split(/\s+/);
	const dig = t.replace(/\D/g, "");
	const filtro = dig.length >= 7 ? { celular: { lk: dig.slice(-8) } } : { nombre: { lk: palabras[0] } };
	let p = await dentalinkGet(env, "pacientes", q(filtro), 2);
	if (dig.length < 7 && palabras.length > 1) {
		const resto = palabras.slice(1).join(" ").toLowerCase();
		p = p.filter((x) => String(x.apellidos ?? "").toLowerCase().includes(resto));
	}
	return {
		total: p.length,
		pacientes: p.slice(0, 5).map((x) => ({
			file: `F-${x.id}`,
			alias: String(x.nombre_social ?? "").trim() || null,
			nombre: `${x.nombre ?? ""} ${x.apellidos ?? ""}`.trim(),
			celular_termina_en: ultimos4(x.celular),
		})),
	};
}

export async function citas_paciente(env: Env, a: { file: string }) {
	const id = idDeFile(a.file);
	const c = await dentalinkGet(env, `pacientes/${id}/citas`, {}, 3);
	const h = hoyMx();
	const prox = c
		.filter((x) => x.fecha >= h && !ANULADA.has(x.id_estado))
		.sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)))
		.slice(0, 5)
		.map(cita);
	const ult = c
		.filter((x) => x.fecha < h)
		.sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)))
		.slice(0, 5)
		.map(cita);
	return { file: `F-${id}`, proximas: prox, ultimas: ult };
}

export async function huecos(env: Env, a: { fecha?: string; duracion?: number; id_dentista?: number }) {
	const p: Row = { id_sucursal: SUCURSAL, fecha: a.fecha || hoyMx(1), duracion: Number(a.duracion) || 30 };
	if (a.id_dentista) p.id_dentista = Number(a.id_dentista);
	const h = await dentalinkGet(env, "agendas/", q(p), 2);
	return {
		fecha: p.fecha,
		total: h.length,
		huecos: h.slice(0, 40).map((x) => ({ fecha: x.fecha, hora: x.hora_inicio, profesional: x.nombre_dentista, id_profesional: x.id_dentista, consultorio: x.id_recurso })),
	};
}

export async function dentistas(env: Env) {
	return {
		dentistas: (await dentalinkGet(env, "dentistas", {}, 3)).map((d) => ({
			id: d.id,
			nombre: `${d.nombre ?? ""} ${d.apellidos ?? ""}`.trim(),
			especialidad: d.especialidad,
			habilitado: d.habilitado,
		})),
	};
}

/** Junta, a cualquier profundidad, los objetos que traen estado de solicitud a laboratorio. */
export function prestacionesConLaboratorio(o: unknown, out: Row[] = []): Row[] {
	if (Array.isArray(o)) o.forEach((x) => prestacionesConLaboratorio(x, out));
	else if (o && typeof o === "object") {
		if ("nombre_estado_solicitud_laboratorio" in o) out.push(o as Row);
		Object.values(o).forEach((x) => prestacionesConLaboratorio(x, out));
	}
	return out;
}

export async function laboratorio_paciente(env: Env, a: { file: string }) {
	const id = idDeFile(a.file);
	const planes = (await dentalinkGet(env, `pacientes/${id}/tratamientos`, {}, 2)).filter((t) => !Number(t.finalizado)).slice(0, 4);
	const out = [];
	for (const t of planes) {
		try {
			const d = await dentalinkOne(env, `tratamientos/${encodeURIComponent(String(t.id))}/desgloce-por-seccion`);
			out.push({
				plan: t.nombre,
				fecha: t.fecha,
				profesional: t.nombre_dentista,
				prestaciones: prestacionesConLaboratorio(d)
					.slice(0, MAX)
					.map((p) => ({
						prestacion: p.nombre_prestacion,
						tipo: p.nombre_tipo_prestacion,
						estado_prestacion: p.estado_prestacion,
						solicitud_laboratorio: p.nombre_estado_solicitud_laboratorio || "(sin solicitud registrada)",
					})),
			});
		} catch {
			out.push({ plan: t.nombre, error: "Dentalink no devolvió el desglose de este plan" });
		}
	}
	return {
		file: `F-${id}`,
		planes_activos: out,
		nota: "Si no hay solicitud registrada, el estado del trabajo se toma de Monday › Laboratorio · Órdenes.",
	};
}

export async function laboratorios(env: Env) {
	return {
		laboratorios: (await dentalinkGet(env, "laboratorios", {}, 2)).map((l) => ({ id: l.id, nombre: l.nombre, habilitado: l.habilitado })),
	};
}
