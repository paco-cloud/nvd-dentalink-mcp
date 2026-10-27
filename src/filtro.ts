/**
 * Filtro por campo y por fila (NVD-TK-41, fase 3). Se aplica a la respuesta de la
 * herramienta ANTES de devolverla, segun el perfil y perfiles/matriz.json:
 *
 * - `campos`: campo de la respuesta → grupo que exige. Sin el grupo, el campo se quita
 *   (hoy: celular_termina_en de buscar_paciente exige «contacto»).
 * - `restricciones`: filtros por fila. Hoy: Laboratorio solo ve, en las herramientas
 *   de agenda, a los profesionales de protesis, ortodoncia y cirugia.
 *
 * Lista blanca: tools.ts ya arma cada respuesta campo por campo; aqui solo se quita.
 * El modo lo decide perfiles.ts: en «sombra» se registra lo que se quitaria y la
 * respuesta sale completa; en «activo» sale filtrada.
 */
import { matriz } from "./matriz.ts";
import type { Perfil } from "./perfil-tipos.ts";
import { dentistas } from "./tools.ts";

export type Filtrado = { resultado: unknown; quitado: string[] };

const AGENDA = new Set(["agenda_dia", "citas_proximas", "confirmaciones_pendientes", "huecos", "dentistas"]);

const sinAcentos = (s: unknown) =>
	String(s ?? "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "");

/** Ids de los profesionales cuya especialidad coincide con alguna de la lista. */
export function idsPorEspecialidad(lista: { id: unknown; especialidad: unknown }[], especialidades: string[]): Set<number> {
	const buscadas = especialidades.map(sinAcentos);
	return new Set(lista.filter((d) => buscadas.some((e) => sinAcentos(d.especialidad).includes(e))).map((d) => Number(d.id)));
}

function quitarCampo(lista: unknown, campo: string): boolean {
	let quito = false;
	if (Array.isArray(lista)) {
		for (const x of lista) {
			if (x && typeof x === "object" && campo in x) {
				delete (x as Record<string, unknown>)[campo];
				quito = true;
			}
		}
	}
	return quito;
}

/** Deja solo las filas con id_profesional (o id, en dentistas) dentro del conjunto. */
function soloProfesionales(r: Record<string, unknown>, clave: "citas" | "huecos" | "dentistas", ids: Set<number>): number {
	const lista = r[clave];
	if (!Array.isArray(lista)) return 0;
	const campo = clave === "dentistas" ? "id" : "id_profesional";
	const dentro = lista.filter((x) => ids.has(Number(x?.[campo])));
	const fuera = lista.length - dentro.length;
	r[clave] = dentro;
	if (typeof r.total === "number") r.total = dentro.length;
	return fuera;
}

/**
 * Filtra `resultado` (se modifica en el lugar) para `perfil` y `herramienta`.
 * `quitado` lleva solo nombres de campos o conteos: nunca valores.
 */
export async function filtrar(env: Env, perfil: Perfil, herramienta: string, resultado: unknown): Promise<Filtrado> {
	const quitado: string[] = [];
	if (!resultado || typeof resultado !== "object") return { resultado, quitado };
	const r = resultado as Record<string, unknown>;
	const grupos = matriz.perfiles[perfil.perfil] ?? [];

	// Por campo.
	for (const [campo, grupo] of Object.entries(matriz.campos[herramienta] ?? {})) {
		if (grupos.includes(grupo)) continue;
		for (const lista of Object.values(r)) if (quitarCampo(lista, campo)) quitado.push(campo);
	}

	// Por fila: Laboratorio en agenda.
	const esp = matriz.restricciones[perfil.perfil]?.agenda_especialidades;
	if (esp && AGENDA.has(herramienta)) {
		const ids = idsPorEspecialidad(herramienta === "dentistas" ? (r.dentistas as any[]) : (await dentistas(env)).dentistas, esp);
		for (const clave of ["citas", "huecos", "dentistas"] as const) {
			const fuera = soloProfesionales(r, clave, ids);
			if (fuera) quitado.push(`${clave}_otra_especialidad:${fuera}`);
		}
	}
	return { resultado: r, quitado };
}
