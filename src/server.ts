import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { DentalinkError } from "./dentalink.ts";
import { ahoraMx, fileDe, registrar, type Resultado } from "./bitacora.ts";
import { filtrar } from "./filtro.ts";
import { conLlave, llaveDe, LlaveNoDisponible } from "./llaves.ts";
import { compuerta, logFiltro } from "./perfiles.ts";
import * as T from "./tools.ts";

/**
 * Registro MCP de las 9 herramientas (logica en tools.ts). Cada llamada deja en
 * el log solo el nombre de la herramienta, el correo y, desde NVD-TK-41, el perfil
 * y el resultado (permitido o negado); nunca argumentos ni respuestas.
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const INSTRUCCIONES =
	"Consultas de sólo lectura a Dentalink de Novodent. Identifica pacientes por alias o nombre + File (F-número). " +
	"No repitas celulares completos ni datos clínicos.";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "AAAA-MM-DD");
const idDentista = z.number().int().positive().describe("Opcional; ver la herramienta dentistas");
const dias = (def: number) => z.number().int().min(1).max(7).describe(`1 a 7; por defecto ${def}`);
const file = z.string().min(1).max(20).describe("F-1234 o 1234");
const soloLectura = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function correoActual(): string | null {
	const email = getMcpAuthContext()?.props?.email;
	return typeof email === "string" ? email : null;
}

/** `file`: el File consultado, si la herramienta lo recibe. Es lo unico de los argumentos que va a la bitacora. */
async function run(env: Env, herramienta: string, fn: (env: Env) => Promise<unknown>, file?: unknown): Promise<ToolResult> {
	// Perfil por llamada (NVD-TK-41): en modo «activo» niega; en «sombra» solo registra.
	const correo = correoActual();
	const c = await compuerta(env, correo, herramienta);
	const entrada = {
		fecha_hora_mx: ahoraMx(),
		correo,
		perfil: c.perfil?.perfil ?? null,
		herramienta,
		file: fileDe(file),
		resultado: c.resultado as Resultado,
		modo: c.modo,
		motivo: c.motivo as string | null,
		quitado: [] as string[],
	};
	if (c.negado) {
		await registrar(env, entrada);
		return { content: [{ type: "text", text: c.negado }], isError: true };
	}
	try {
		// Llave de Dentalink del dominio de la herramienta (fase 6). Solo se registra el dominio.
		const llave = llaveDe(env, herramienta);
		console.log(JSON.stringify({ evento: "llave", herramienta, dominio: llave.dominio }));
		const e = conLlave(env, llave);
		let r = await fn(e);
		// Filtro por campo y por fila (fase 3): en sombra solo se registra; en activo se aplica.
		if (c.perfil) {
			const f = await filtrar(e, c.perfil, herramienta, c.modo === "activo" ? r : structuredClone(r));
			logFiltro(herramienta, correo, c.perfil, c.modo, f.quitado);
			if (c.modo === "activo") r = f.resultado;
			if (f.quitado.length) {
				entrada.quitado = f.quitado;
				entrada.resultado = c.modo === "activo" ? "filtrado" : "filtraria";
			}
		}
		await registrar(env, entrada);
		return { content: [{ type: "text", text: JSON.stringify(r) }] };
	} catch (err) {
		// Sin detalle de la respuesta de Dentalink: puede traer datos.
		const msg =
			err instanceof T.UsoError || err instanceof LlaveNoDisponible
				? err.message
				: err instanceof DentalinkError
					? err.status === 429
						? err.message
						: `Dentalink no respondió bien (${err.status}).`
					: "Error al consultar Dentalink.";
		// Tambien queda en la bitacora: quien intento que y por que fallo (sin cuerpo de Dentalink).
		entrada.resultado = "error";
		entrada.motivo = err instanceof T.UsoError ? "uso" : err instanceof LlaveNoDisponible ? "sin_llave" : err instanceof DentalinkError ? `dentalink_${err.status}` : "error";
		await registrar(env, entrada);
		return { content: [{ type: "text", text: msg }], isError: true };
	}
}

export function createServer(env: Env): McpServer {
	const server = new McpServer({ name: "novodent-dentalink", version: "1.0.0" }, { instructions: INSTRUCCIONES });

	server.registerTool(
		"agenda_dia",
		{
			description: "Citas de un día en Novodent (hora, profesional, consultorio, estado, paciente por alias o nombre y su File). Sin datos clínicos.",
			inputSchema: { fecha: fecha.optional().describe("AAAA-MM-DD; por defecto hoy"), id_dentista: idDentista.optional() },
			annotations: soloLectura,
		},
		async (a) => run(env, "agenda_dia", (e) => T.agenda_dia(e, a)),
	);

	server.registerTool(
		"confirmaciones_pendientes",
		{
			description: "Citas sin confirmar de los próximos días (por defecto 2).",
			inputSchema: { dias: dias(2).optional() },
			annotations: soloLectura,
		},
		async (a) => run(env, "confirmaciones_pendientes", (e) => T.confirmaciones_pendientes(e, a)),
	);

	server.registerTool(
		"citas_proximas",
		{
			description:
				"Citas de los próximos días, opcionalmente de un profesional. Útil para la rutina diaria de laboratorio (qué pacientes vienen y necesitan su trabajo listo).",
			inputSchema: { dias: dias(3).optional(), id_dentista: idDentista.optional() },
			annotations: soloLectura,
		},
		async (a) => run(env, "citas_proximas", (e) => T.citas_proximas(e, a)),
	);

	server.registerTool(
		"buscar_paciente",
		{
			description: "Busca pacientes por nombre, apellido o celular. Devuelve hasta 5: alias o nombre, File y últimos 4 dígitos del celular.",
			inputSchema: { texto: z.string().min(3).max(80) },
			annotations: soloLectura,
		},
		async (a) => run(env, "buscar_paciente", (e) => T.buscar_paciente(e, a)),
	);

	server.registerTool(
		"citas_paciente",
		{
			description: "Próximas y últimas citas de un paciente por su File (F-número).",
			inputSchema: { file },
			annotations: soloLectura,
		},
		async (a) => run(env, "citas_paciente", (e) => T.citas_paciente(e, a), a.file),
	);

	server.registerTool(
		"huecos",
		{
			description: "Horarios libres en la agenda en línea de Dentalink para una fecha (sólo profesionales con agenda en línea).",
			inputSchema: {
				fecha: fecha.optional().describe("AAAA-MM-DD; por defecto mañana"),
				duracion: z.number().int().min(5).max(480).optional().describe("minutos; por defecto 30"),
				id_dentista: idDentista.optional(),
			},
			annotations: soloLectura,
		},
		async (a) => run(env, "huecos", (e) => T.huecos(e, a)),
	);

	server.registerTool(
		"dentistas",
		{
			description: "Catálogo de profesionales con su id, especialidad y si están habilitados.",
			inputSchema: {},
			annotations: soloLectura,
		},
		async () => run(env, "dentistas", (e) => T.dentistas(e)),
	);

	server.registerTool(
		"laboratorio_paciente",
		{
			description:
				"Trabajos de laboratorio de un paciente por File: prestaciones de sus planes activos con su estado y el estado de la solicitud a laboratorio en Dentalink (si se registró).",
			inputSchema: { file },
			annotations: soloLectura,
		},
		async (a) => run(env, "laboratorio_paciente", (e) => T.laboratorio_paciente(e, a), a.file),
	);

	server.registerTool(
		"laboratorios",
		{
			description: "Catálogo de laboratorios dados de alta en Dentalink.",
			inputSchema: {},
			annotations: soloLectura,
		},
		async () => run(env, "laboratorios", (e) => T.laboratorios(e)),
	);

	return server;
}
