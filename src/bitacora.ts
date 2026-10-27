/**
 * Bitacora de consultas (NVD-TK-41, fase 4).
 *
 * Cada llamada a una herramienta deja una entrada en el KV BITACORA (90 dias) con:
 * fecha y hora, correo, perfil, herramienta, File consultado (si aplica), resultado
 * (permitido, negado, filtrado, negaria, filtraria o sin_filtro), modo y motivo.
 * Nunca nombres, celulares, montos, texto clinico ni argumentos de busqueda.
 *
 * Una vez al dia (cron) las entradas del dia anterior se agregan a
 * NVD · Operacion clinica › BITACORA_CONSULTAS. Un marcador en KV evita duplicados;
 * si la hoja falla, no se marca y se reintenta al dia siguiente. El KV es la
 * fuente; la hoja es la vista para Mel y Paco.
 */
import { hoyMx } from "./tools.ts";

export type Resultado = "permitido" | "negado" | "filtrado" | "negaria" | "filtraria" | "sin_filtro";

export type Entrada = {
	fecha_hora_mx: string;
	correo: string | null;
	perfil: string | null;
	herramienta: string;
	file: string | null;
	resultado: Resultado;
	modo: string;
	motivo: string | null;
	quitado: string[];
};

export const RETENCION_S = 90 * 24 * 3600;
const PREFIJO = "consulta/";
const MARCA = "exportado/";

/** Hora de Mexico (UTC-6) en ISO sin zona, con milisegundos para ordenar. */
export function ahoraMx(ahora = Date.now()): string {
	return new Date(ahora - 6 * 3600e3).toISOString().replace("T", " ").replace("Z", "");
}

/** Normaliza un File a «F-1234» o null. Nunca guarda otro argumento. */
export function fileDe(v: unknown): string | null {
	const id = String(v ?? "").replace(/\D/g, "");
	return id ? `F-${id}` : null;
}

/** Guarda una entrada. Si el KV falla, lo registra en el log y no interrumpe la respuesta. */
export async function registrar(env: Env, e: Entrada): Promise<void> {
	if (!env.BITACORA) return;
	const dia = e.fecha_hora_mx.slice(0, 10);
	const clave = `${PREFIJO}${dia}/${e.fecha_hora_mx.slice(11)}/${crypto.randomUUID().slice(0, 8)}`;
	try {
		await env.BITACORA.put(clave, JSON.stringify(e), { expirationTtl: RETENCION_S });
	} catch (err) {
		console.log(JSON.stringify({ evento: "bitacora", resultado: "no_guardada", causa: err instanceof Error ? err.message : "error" }));
	}
}

/** Entradas de un dia (AAAA-MM-DD), en orden. */
export async function entradasDe(env: Env, dia: string): Promise<Entrada[]> {
	const out: Entrada[] = [];
	let cursor: string | undefined;
	do {
		const l = await env.BITACORA.list({ prefix: `${PREFIJO}${dia}/`, cursor });
		for (const k of l.keys) {
			const v = await env.BITACORA.get(k.name);
			if (v) out.push(JSON.parse(v));
		}
		cursor = l.list_complete ? undefined : l.cursor;
	} while (cursor);
	return out;
}

/** Fila para la hoja, en el orden de los encabezados de BITACORA_CONSULTAS. */
export const fila = (e: Entrada, exportado: string): (string | null)[] => [
	e.fecha_hora_mx,
	e.correo,
	e.perfil,
	e.herramienta,
	e.file,
	e.resultado,
	e.modo,
	e.motivo,
	e.quitado.join(", "),
	exportado,
];

/**
 * Exporta las entradas de `dia` (por defecto ayer en Mexico) a la hoja.
 * `appendFilas` lo pone perfiles.ts (token de Google con permiso de escritura).
 */
export async function exportar(
	env: Env,
	appendFilas: (env: Env, filas: (string | null)[][]) => Promise<void>,
	dia = hoyMx(-1),
): Promise<{ dia: string; filas: number; exportado: boolean }> {
	if (!env.BITACORA || !env.BITACORA_SHEET_ID) return { dia, filas: 0, exportado: false };
	if (await env.BITACORA.get(`${MARCA}${dia}`)) return { dia, filas: 0, exportado: true };
	const entradas = await entradasDe(env, dia);
	const cuando = ahoraMx();
	if (entradas.length) await appendFilas(env, entradas.map((e) => fila(e, cuando)));
	// Solo despues de que la hoja acepto las filas; si fallo, se reintenta manana.
	await env.BITACORA.put(`${MARCA}${dia}`, cuando, { expirationTtl: RETENCION_S });
	console.log(JSON.stringify({ evento: "bitacora", resultado: "exportada", dia, filas: entradas.length }));
	return { dia, filas: entradas.length, exportado: true };
}
