/**
 * Llave de Dentalink por dominio (NVD-TK-41, fase 6). Cada herramienta usa la llave
 * de su grupo segun perfiles/matriz.json › llaves:
 *
 *   agenda  → DENTALINK_TOKEN_AGENDA  (nvdagenda: citas, agendas, dentistas, pacientes)
 *   clinico → DENTALINK_TOKEN_CLINICO (nvdclinico: tratamientos, evoluciones, recetas)
 *   pagos   → DENTALINK_TOKEN_PAGOS   (nvdpagos)
 *
 * Transicion sin detener la operacion: si la llave del dominio todavia no esta
 * cargada, se usa DENTALINK_TOKEN (nvdasistentes) mientras exista. Cuando Paco borra
 * ese secreto, una herramienta sin llave de su dominio se niega (falla cerrado).
 *
 * Nunca se registra el valor de una llave: solo el dominio y si fue la de respaldo.
 */
import { matriz, type Dominio, type Matriz } from "./matriz.ts";

export class LlaveNoDisponible extends Error {
	constructor() {
		super("El conector no tiene llave de Dentalink para esta consulta. Avisa a Paco.");
	}
}

const SECRETO: Record<Dominio, "DENTALINK_TOKEN_AGENDA" | "DENTALINK_TOKEN_CLINICO" | "DENTALINK_TOKEN_PAGOS"> = {
	agenda: "DENTALINK_TOKEN_AGENDA",
	clinico: "DENTALINK_TOKEN_CLINICO",
	pagos: "DENTALINK_TOKEN_PAGOS",
};

export type Llave = { dominio: Dominio; origen: "dominio" | "respaldo"; token: string };

const valor = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** La llave que corresponde a la herramienta, o LlaveNoDisponible. */
export function llaveDe(env: Env, herramienta: string, m: Matriz = matriz): Llave {
	const grupo = m.herramientas[herramienta]?.grupo;
	const dominio = grupo ? m.llaves[grupo] : undefined;
	if (!dominio) throw new LlaveNoDisponible();
	const propia = valor((env as unknown as Record<string, unknown>)[SECRETO[dominio]]);
	if (propia) return { dominio, origen: "dominio", token: propia };
	const respaldo = valor(env.DENTALINK_TOKEN);
	if (respaldo) return { dominio, origen: "respaldo", token: respaldo };
	throw new LlaveNoDisponible();
}

/** Copia de env donde DENTALINK_TOKEN es la llave del dominio; dentalink.ts no cambia. */
export function conLlave(env: Env, llave: Llave): Env {
	return { ...env, DENTALINK_TOKEN: llave.token } as Env;
}
