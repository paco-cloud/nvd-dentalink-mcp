/**
 * Cliente de Dentalink. SOLO GET (regla 3 de NVD-TK-17): no existe otro metodo aqui.
 * Nunca registra argumentos ni respuestas (regla 4).
 */

export type Row = Record<string, unknown>;

const MAX_PAGES = 10;

export class DentalinkError extends Error {
	readonly status: number;
	constructor(status: number) {
		super(`Dentalink respondio ${status}`);
		this.status = status;
	}
}

function baseUrl(env: Env): URL {
	const base = new URL(env.DENTALINK_BASE_URL.replace(/\/+$/, "") + "/");
	if (base.protocol !== "https:") throw new Error("DENTALINK_BASE_URL debe ser https");
	return base;
}

/** Arma la URL de un recurso. Rechaza rutas absolutas o que salgan de la base. */
export function buildUrl(env: Env, path: string, params: Record<string, string | undefined> = {}): URL {
	if (/^[a-z]+:/i.test(path) || path.includes("..")) throw new Error("ruta invalida");
	const base = baseUrl(env);
	const url = new URL(path.replace(/^\/+/, ""), base);
	if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error("ruta invalida");
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
	return url;
}

async function getJson(env: Env, url: URL): Promise<any> {
	const res = await fetch(url, {
		method: "GET",
		headers: { Authorization: `Token ${env.DENTALINK_TOKEN}`, Accept: "application/json" },
	});
	if (!res.ok) throw new DentalinkError(res.status);
	return res.json();
}

/**
 * GET con paginacion. Dentalink devuelve { data, links: { next } }.
 * El `next` solo se sigue si apunta al mismo origen y base.
 */
export async function dentalinkGet(
	env: Env,
	path: string,
	params: Record<string, string | undefined> = {},
): Promise<Row[]> {
	const base = baseUrl(env);
	let url: URL | null = buildUrl(env, path, params);
	const rows: Row[] = [];
	for (let page = 0; url && page < MAX_PAGES; page++) {
		const body = await getJson(env, url);
		const data = body?.data;
		if (Array.isArray(data)) rows.push(...data);
		else if (data && typeof data === "object") rows.push(data);
		const next: unknown = body?.links?.next;
		url = null;
		if (typeof next === "string" && next) {
			const candidate = new URL(next, base);
			if (candidate.origin === base.origin && candidate.pathname.startsWith(base.pathname)) url = candidate;
		}
	}
	return rows;
}

/** Lista blanca: solo salen los campos nombrados. Todo lo demas se descarta. */
export function pick(row: Row, fields: readonly string[]): Row {
	const out: Row = {};
	for (const f of fields) if (f in row) out[f] = row[f];
	return out;
}

/** Celular enmascarado: solo los ultimos 4 digitos. */
export function maskPhone(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const digits = String(value).replace(/\D/g, "");
	if (!digits) return null;
	return digits.length <= 4 ? "****" : `******${digits.slice(-4)}`;
}
