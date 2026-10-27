/**
 * Matriz por herramienta (NVD-TK-41, fase 2). La tabla vive en perfiles/matriz.json,
 * versionada y sin datos personales; aqui solo se valida y se consulta.
 *
 * Falla cerrado: herramienta que no esta en la matriz, perfil sin el grupo, o
 * bandera exigida que la persona no tiene → negar. El modo (sombra/activo) lo
 * decide perfiles.ts; esto solo dice si pasaria.
 */
import matrizJson from "../perfiles/matriz.json" with { type: "json" };
import { PERFILES, type NombrePerfil, type Perfil } from "./perfil-tipos.ts";

type Bandera = "registra_pagos" | "anula" | "escribe_evoluciones";
export type Matriz = {
	version: string;
	grupos: Record<string, string>;
	herramientas: Record<string, { grupo: string; bandera?: Bandera }>;
	perfiles: Record<NombrePerfil, string[]>;
};

const BANDERAS: readonly Bandera[] = ["registra_pagos", "anula", "escribe_evoluciones"];

/** Revisa la forma de la matriz al cargar: un JSON mal hecho tumba el deploy, no abre la puerta. */
export function validar(m: unknown): Matriz {
	const x = m as Matriz;
	if (!x || typeof x.version !== "string" || !x.grupos || !x.herramientas || !x.perfiles) throw new Error("matriz.json: forma invalida");
	for (const [h, def] of Object.entries(x.herramientas)) {
		if (!(def.grupo in x.grupos)) throw new Error(`matriz.json: ${h} usa un grupo desconocido`);
		if (def.bandera !== undefined && !BANDERAS.includes(def.bandera)) throw new Error(`matriz.json: ${h} usa una bandera desconocida`);
	}
	for (const p of PERFILES) {
		const grupos = x.perfiles[p];
		if (!Array.isArray(grupos)) throw new Error(`matriz.json: falta el perfil ${p}`);
		for (const g of grupos) if (!(g in x.grupos)) throw new Error(`matriz.json: ${p} usa un grupo desconocido`);
	}
	for (const p of Object.keys(x.perfiles)) if (!(PERFILES as readonly string[]).includes(p)) throw new Error(`matriz.json: perfil desconocido ${p}`);
	return x;
}

export const matriz: Matriz = validar(matrizJson);

export type Veredicto = { ok: true; grupo: string } | { ok: false; motivo: "herramienta_desconocida" | "perfil_sin_grupo" | "sin_bandera"; grupo: string | null };

/** ¿Este perfil puede usar esta herramienta? */
export function permite(perfil: Perfil, herramienta: string, m: Matriz = matriz): Veredicto {
	const def = m.herramientas[herramienta];
	if (!def) return { ok: false, motivo: "herramienta_desconocida", grupo: null };
	if (!m.perfiles[perfil.perfil]?.includes(def.grupo)) return { ok: false, motivo: "perfil_sin_grupo", grupo: def.grupo };
	if (def.bandera && !perfil[def.bandera]) return { ok: false, motivo: "sin_bandera", grupo: def.grupo };
	return { ok: true, grupo: def.grupo };
}
