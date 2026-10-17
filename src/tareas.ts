/**
 * Tareas de gestion atrasadas (NIA-DEV-008, B). Solo lectura.
 *
 * Lista blanca estricta: la respuesta se arma campo por campo. Nunca salen
 * nombre, asunto ni notas; el paciente va solo como File.
 *
 * NO esta registrada en server.ts todavia: NIA-DEV-008 depende de NIA-DEV-007
 * (filtro por perfil y bitacora), y nada se abre a mas personas antes de eso.
 */
import { dentalinkGet, q, type Row } from "./dentalink.ts";
import { hoyMx, UsoError } from "./tools.ts";

/**
 * Ruta y nombres de campo de Dentalink [POR VERIFICAR · paso 1 de NIA-DEV-008].
 * No hay documentacion publica de la API: se confirman con una consulta real a
 * un folio de prueba. Si cambian, se ajusta solo este bloque.
 */
const RUTA = "tareas";
const CAMPO = {
	id: "id",
	paciente: "id_paciente",
	tipo: "nombre_tipo",
	creada: "fecha_creacion",
	vence: "fecha_vencimiento",
	responsable: "nombre_usuario",
	estado: "estado",
} as const;

export const TIPOS = ["Cita", "Captura", "Control", "Cobranza", "Personalizada"] as const;
export type Tipo = (typeof TIPOS)[number];

/** Una tarea en estos estados ya no cuenta como atrasada. */
const CERRADAS = new Set(["cerrada", "cerrado", "completada", "completado", "finalizada", "cancelada"]);

const MAX = 50;

const texto = (v: unknown) => String(v ?? "").trim();

/** Lista blanca: ocho campos y ni uno mas. */
export const tarea = (t: Row) => ({
	id_tarea: t[CAMPO.id],
	file: t[CAMPO.paciente] ? `F-${t[CAMPO.paciente]}` : null,
	tipo: texto(t[CAMPO.tipo]) || null,
	creada: texto(t[CAMPO.creada]) || null,
	vence: texto(t[CAMPO.vence]) || null,
	responsable: texto(t[CAMPO.responsable]) || null,
	estado: texto(t[CAMPO.estado]) || null,
});

export function esAtrasada(t: Row, hoy = hoyMx()): boolean {
	const vence = texto(t[CAMPO.vence]).slice(0, 10);
	if (!vence) return false;
	if (CERRADAS.has(texto(t[CAMPO.estado]).toLowerCase())) return false;
	return vence < hoy;
}

function tipoValido(tipo: unknown): Tipo | undefined {
	const v = texto(tipo);
	if (!v) return undefined;
	const encontrado = TIPOS.find((t) => t.toLowerCase() === v.toLowerCase());
	if (!encontrado) throw new UsoError(`Tipo no valido. Usa uno de: ${TIPOS.join(", ")}.`);
	return encontrado;
}

/** Filtra y ordena sin tocar la red, para poder probarlo en Node. */
export function filtrarTareas(filas: Row[], a: { tipo?: string; responsable?: string; hoy?: string } = {}) {
	const tipo = tipoValido(a.tipo);
	const responsable = texto(a.responsable).toLowerCase();
	const hoy = a.hoy || hoyMx();
	return filas
		.filter((t) => esAtrasada(t, hoy))
		.filter((t) => !tipo || texto(t[CAMPO.tipo]).toLowerCase() === tipo.toLowerCase())
		.filter((t) => !responsable || texto(t[CAMPO.responsable]).toLowerCase() === responsable)
		.sort((x, y) => texto(x[CAMPO.vence]).localeCompare(texto(y[CAMPO.vence])));
}

export async function tareas_atrasadas(env: Env, a: { tipo?: string; responsable?: string } = {}) {
	const hoy = hoyMx();
	const filas = await dentalinkGet(env, RUTA, q({ [CAMPO.vence]: { lt: hoy } }), 12);
	const atrasadas = filtrarTareas(filas, { ...a, hoy });
	return { hoy, total: atrasadas.length, tareas: atrasadas.slice(0, MAX).map(tarea) };
}
