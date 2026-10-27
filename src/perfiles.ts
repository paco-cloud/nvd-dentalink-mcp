/**
 * Perfil por llamada (NVD-TK-41, fase 1).
 *
 * Fuente: NVD · Catalogos › USUARIOS_ROLES (Google Sheets), leida con la cuenta de
 * servicio de GOOGLE_SA_JSON. Columnas de la hoja (26-oct-2026):
 *   A correo · E puede_registrar_pagos · F puede_anular · G puede_escribir_evoluciones
 *   H activo · K perfil. Nombres, puestos y notas no se leen ni se guardan.
 *
 * Falla cerrado: sin hoja, sin fila, inactivo o «Por confirmar» → negar. Con perfil,
 * la matriz por herramienta (matriz.ts, fase 2) decide si esa herramienta pasa.
 * Cache en memoria de 5 minutos por isolate; si la hoja no responde y no hay
 * cache vigente, se niega (no se usa una copia vieja).
 *
 * PERFILES_MODO: «apagado» (comportamiento previo, reversa del ticket §7),
 * «sombra» (registra lo que negaria y responde) o «activo» (niega). Un valor
 * desconocido cuenta como «activo».
 *
 * Nunca registra el JSON de la cuenta de servicio ni el token de Google.
 */

import { permite } from "./matriz.ts";
import { PERFILES, type NombrePerfil, type Perfil } from "./perfil-tipos.ts";

export { PERFILES, type NombrePerfil, type Perfil };

export type Modo = "apagado" | "sombra" | "activo";

/** La hoja no se pudo leer: perfil no disponible. */
export class PerfilNoDisponible extends Error {
	constructor() {
		super("Perfil no disponible: no se pudo leer USUARIOS_ROLES. Intenta en unos minutos.");
	}
}

export const cache = { ttlMs: 5 * 60e3, tokenMs: 50 * 60e3 };
let filas: { leidas: number; porCorreo: Map<string, Perfil> } | null = null;
let token: { valor: string; vence: number } | null = null;

export function modo(env: { PERFILES_MODO?: string }): Modo {
	const m = (env.PERFILES_MODO ?? "").trim().toLowerCase();
	if (m === "" || m === "apagado") return "apagado";
	return m === "sombra" ? "sombra" : "activo";
}

const verdadero = (v: unknown) => ["true", "sí", "si", "1", "x"].includes(String(v ?? "").trim().toLowerCase());

/** Convierte las filas A:L de la hoja en perfiles. Solo entran filas activas con perfil valido. */
export function parsearFilas(values: unknown[][]): Map<string, Perfil> {
	const out = new Map<string, Perfil>();
	for (const f of values) {
		const correo = String(f[0] ?? "").trim().toLowerCase();
		const perfil = String(f[10] ?? "").trim();
		if (!correo.endsWith("@novodent.mx") || !verdadero(f[7])) continue;
		if (!(PERFILES as readonly string[]).includes(perfil)) continue;
		out.set(correo, {
			correo,
			perfil: perfil as NombrePerfil,
			registra_pagos: verdadero(f[4]),
			anula: verdadero(f[5]),
			escribe_evoluciones: verdadero(f[6]),
		});
	}
	return out;
}

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
	const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
	let s = "";
	for (const x of bytes) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemABytes(pem: string): Uint8Array {
	const b64 = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** JWT RS256 firmado con la cuenta de servicio, para pedir un token de solo lectura de Sheets. */
export async function firmarAsercion(sa: { client_email: string; private_key: string; token_uri?: string }, ahora = Date.now()): Promise<string> {
	const iat = Math.floor(ahora / 1000);
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const claims = b64url(
		JSON.stringify({
			iss: sa.client_email,
			scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
			aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
			iat,
			exp: iat + 3600,
		}),
	);
	const key = await crypto.subtle.importKey("pkcs8", pemABytes(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
	const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
	return `${header}.${claims}.${b64url(firma)}`;
}

async function tokenGoogle(env: Env): Promise<string> {
	if (token && token.vence > Date.now()) return token.valor;
	const sa = JSON.parse(env.GOOGLE_SA_JSON ?? "{}");
	if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SA_JSON incompleto");
	const uri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
	const res = await fetch(uri, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await firmarAsercion(sa) }),
	});
	if (!res.ok) throw new Error(`token de Google: ${res.status}`);
	const body: any = await res.json();
	if (typeof body?.access_token !== "string") throw new Error("token de Google sin access_token");
	token = { valor: body.access_token, vence: Date.now() + cache.tokenMs };
	return token.valor;
}

/** Lee la hoja (con cache de 5 min). Lanza PerfilNoDisponible si no se puede. */
export async function cargarPerfiles(env: Env): Promise<Map<string, Perfil>> {
	if (filas && Date.now() - filas.leidas < cache.ttlMs) return filas.porCorreo;
	try {
		const id = env.PERFILES_SHEET_ID;
		if (!id) throw new Error("PERFILES_SHEET_ID vacio");
		const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent("USUARIOS_ROLES!A2:L")}?majorDimension=ROWS`;
		const res = await fetch(url, { headers: { Authorization: `Bearer ${await tokenGoogle(env)}` } });
		if (!res.ok) throw new Error(`Sheets: ${res.status}`);
		const body: any = await res.json();
		const porCorreo = parsearFilas(Array.isArray(body?.values) ? body.values : []);
		filas = { leidas: Date.now(), porCorreo };
		return porCorreo;
	} catch (err) {
		// Sin detalle: la causa va al log, nunca a quien pregunta.
		console.log(JSON.stringify({ evento: "perfiles", resultado: "no_disponible", causa: err instanceof Error ? err.message : "error" }));
		throw new PerfilNoDisponible();
	}
}

/** Vacia la cache (pruebas). */
export function olvidar(): void {
	filas = null;
	token = null;
}

export type Motivo = "sin_correo" | "sin_fila" | "no_disponible" | "herramienta_desconocida" | "perfil_sin_grupo" | "sin_bandera";
export type Decision = { permitido: true; perfil: Perfil; grupo: string } | { permitido: false; motivo: Motivo; perfil: Perfil | null };

/** Perfil de quien llama y veredicto de la matriz para la herramienta. No lanza. */
export async function decidir(env: Env, correo: unknown, herramienta: string): Promise<Decision> {
	if (typeof correo !== "string" || !correo.trim()) return { permitido: false, motivo: "sin_correo", perfil: null };
	let mapa: Map<string, Perfil>;
	try {
		mapa = await cargarPerfiles(env);
	} catch {
		return { permitido: false, motivo: "no_disponible", perfil: null };
	}
	const perfil = mapa.get(correo.trim().toLowerCase());
	if (!perfil) return { permitido: false, motivo: "sin_fila", perfil: null };
	const v = permite(perfil, herramienta);
	return v.ok ? { permitido: true, perfil, grupo: v.grupo } : { permitido: false, motivo: v.motivo, perfil };
}

export const MENSAJE: Record<Motivo, string> = {
	sin_correo: "Sin permiso: no hay inicio de sesión.",
	sin_fila: "Sin permiso: tu correo no tiene un perfil activo en USUARIOS_ROLES. Pide a Mel que lo revise.",
	no_disponible: new PerfilNoDisponible().message,
	herramienta_desconocida: "Sin permiso: esta herramienta no está en la matriz de perfiles.",
	perfil_sin_grupo: "Sin permiso: tu perfil no puede usar esta herramienta.",
	sin_bandera: "Sin permiso: tu perfil puede, pero a tu cuenta le falta la autorización en USUARIOS_ROLES.",
};

/**
 * Compuerta de cada llamada. Devuelve el mensaje de negacion (y la llamada no
 * sigue) o null. Registra {herramienta, correo, perfil, modo, resultado, motivo}:
 * nunca argumentos, nombres ni respuestas.
 */
export async function compuerta(env: Env, correo: string | null, herramienta: string): Promise<string | null> {
	const m = modo(env);
	const d = m === "apagado" ? null : await decidir(env, correo, herramienta);
	const resultado = !d ? "sin_filtro" : d.permitido ? "permitido" : m === "activo" ? "negado" : "negaria";
	console.log(
		JSON.stringify({
			evento: "herramienta",
			herramienta,
			correo,
			perfil: d?.perfil?.perfil ?? null,
			grupo: d?.permitido ? d.grupo : null,
			modo: m,
			resultado,
			motivo: d && !d.permitido ? d.motivo : null,
		}),
	);
	return d && !d.permitido && m === "activo" ? MENSAJE[d.motivo] : null;
}
