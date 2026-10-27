/**
 * Cliente de Dentalink. SOLO GET (regla 3 de NVD-TK-17): no existe otro metodo aqui.
 * Nunca registra argumentos ni respuestas (regla 4).
 *
 * Portado de nvd-mcp.js: una consulta cada 1.1 s por isolate y reintento con
 * espera creciente cuando Dentalink responde 429.
 */

import { LlaveNoDisponible, type EnvConLlave } from "./llaves.ts";

export type Row = Record<string, any>;

export class DentalinkError extends Error {
	readonly status: number;
	constructor(status: number, message = `Dentalink respondio ${status}`) {
		super(message);
		this.status = status;
	}
}

export const ritmo = { intervaloMs: 1100, espera429Ms: 8000 };
let ultima = 0;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function baseUrl(env: Env): URL {
	const base = new URL(env.DENTALINK_BASE_URL.replace(/\/+$/, "") + "/");
	if (base.protocol !== "https:") throw new Error("DENTALINK_BASE_URL debe ser https");
	return base;
}

function dentroDeBase(url: URL, base: URL): boolean {
	return url.origin === base.origin && url.pathname.startsWith(base.pathname);
}

/** Filtro de Dentalink: ?q=<json>. */
export const q = (filtro: object): Record<string, string> => ({ q: JSON.stringify(filtro) });

/** Arma la URL de un recurso. La ruta no puede salir de la base. */
export function buildUrl(env: Env, path: string, params: Record<string, string | undefined> = {}): URL {
	if (/^[a-z]+:/i.test(path) || path.split("/").includes("..")) throw new Error("ruta invalida");
	const base = baseUrl(env);
	const url = new URL(path.replace(/^\/+/, ""), base);
	if (!dentroDeBase(url, base)) throw new Error("ruta invalida");
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
	return url;
}

async function getJson(env: Env, url: URL): Promise<any> {
	for (let i = 0; i < 3; i++) {
		const espera = ultima + ritmo.intervaloMs - Date.now();
		if (espera > 0) await dormir(espera);
		ultima = Date.now();
		// La llave la pone llaves.ts segun el dominio de la herramienta. Sin llave, no se consulta.
		const llave = (env as Partial<EnvConLlave>).LLAVE_DENTALINK;
		if (!llave) throw new LlaveNoDisponible();
		const res = await fetch(url, {
			method: "GET",
			headers: { Authorization: `Token ${llave}`, Accept: "application/json" },
		});
		if (res.status === 429) {
			await dormir(ritmo.espera429Ms * (i + 1));
			continue;
		}
		if (!res.ok) throw new DentalinkError(res.status);
		return res.json();
	}
	throw new DentalinkError(429, "Dentalink esta limitando las consultas; intenta en un minuto.");
}

/** Un solo GET (sin paginar). */
export async function dentalinkOne(env: Env, path: string, params: Record<string, string | undefined> = {}): Promise<any> {
	return getJson(env, buildUrl(env, path, params));
}

/**
 * GET con paginacion. Dentalink devuelve { data, links: { next } }.
 * El `next` solo se sigue si apunta al mismo origen y base.
 */
export async function dentalinkGet(
	env: Env,
	path: string,
	params: Record<string, string | undefined> = {},
	paginas = 6,
): Promise<Row[]> {
	const base = baseUrl(env);
	let url: URL | null = buildUrl(env, path, params);
	const rows: Row[] = [];
	for (let page = 0; url && page < paginas; page++) {
		const body = await getJson(env, url);
		const data = body?.data;
		if (Array.isArray(data)) rows.push(...data);
		else if (data && typeof data === "object") rows.push(data);
		const next: unknown = body?.links?.next;
		url = null;
		if (typeof next === "string" && next) {
			const candidate = new URL(next, base);
			if (dentroDeBase(candidate, base)) url = candidate;
		}
	}
	return rows;
}

/** Celular: solo los ultimos 4 digitos, o null. */
export function ultimos4(value: unknown): string | null {
	const digits = String(value ?? "").replace(/\D/g, "");
	return digits ? digits.slice(-4) : null;
}
