/**
 * Llave de Dentalink por dominio (NVD-TK-41, fase 6). Cada herramienta usa la llave
 * de su grupo segun perfiles/matriz.json › llaves:
 *
 *   agenda  → DENTALINK_TOKEN_AGENDA  (nvdagenda: citas, agendas, dentistas, pacientes)
 *   clinico → DENTALINK_TOKEN_CLINICO (nvdclinico: tratamientos, evoluciones, recetas)
 *   pagos   → DENTALINK_TOKEN_PAGOS   (nvdpagos)
 *
 * nvdasistentes (DENTALINK_TOKEN) se retiro: ya no hay llave de respaldo. Una
 * herramienta sin la llave de su dominio se niega (falla cerrado, motivo sin_llave).
 *
 * Nunca se registra el valor de una llave: solo el dominio.
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

export type Llave = { dominio: Dominio; token: string };

const valor = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** La llave que corresponde a la herramienta, o LlaveNoDisponible. */
export function llaveDe(env: Env, herramienta: string, m: Matriz = matriz): Llave {
	const grupo = m.herramientas[herramienta]?.grupo;
	const dominio = grupo ? m.llaves[grupo] : undefined;
	if (!dominio) throw new LlaveNoDisponible();
	const propia = valor((env as unknown as Record<string, unknown>)[SECRETO[dominio]]);
	if (!propia) throw new LlaveNoDisponible();
	return { dominio, token: propia };
}

/** Env con la llave del dominio ya elegida: es lo unico que dentalink.ts acepta. */
export type EnvConLlave = Env & { readonly LLAVE_DENTALINK: string };

export function conLlave(env: Env, llave: Llave): EnvConLlave {
	return { ...env, LLAVE_DENTALINK: llave.token };
}
