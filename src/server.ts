import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { DentalinkError } from "./dentalink.ts";
import * as T from "./tools.ts";

/**
 * Registro MCP de las 9 herramientas (logica en tools.ts). Cada llamada deja en
 * el log solo el nombre de la herramienta y el correo; nunca argumentos ni respuestas.
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

function logUso(herramienta: string): void {
	const email = getMcpAuthContext()?.props?.email;
	console.log(JSON.stringify({ evento: "herramienta", herramienta, correo: typeof email === "string" ? email : null }));
}

async function run(herramienta: string, fn: () => Promise<unknown>): Promise<ToolResult> {
	logUso(herramienta);
	try {
		return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
	} catch (err) {
		// Sin detalle de la respuesta de Dentalink: puede traer datos.
		const msg =
			err instanceof T.UsoError
				? err.message
				: err instanceof DentalinkError
					? err.status === 429
						? err.message
						: `Dentalink no respondió bien (${err.status}).`
					: "Error al consultar Dentalink.";
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
		async (a) => run("agenda_dia", () => T.agenda_dia(env, a)),
	);

	server.registerTool(
		"confirmaciones_pendientes",
		{
			description: "Citas sin confirmar de los próximos días (por defecto 2).",
			inputSchema: { dias: dias(2).optional() },
			annotations: soloLectura,
		},
		async (a) => run("confirmaciones_pendientes", () => T.confirmaciones_pendientes(env, a)),
	);

	server.registerTool(
		"citas_proximas",
		{
			description:
				"Citas de los próximos días, opcionalmente de un profesional. Útil para la rutina diaria de laboratorio (qué pacientes vienen y necesitan su trabajo listo).",
			inputSchema: { dias: dias(3).optional(), id_dentista: idDentista.optional() },
			annotations: soloLectura,
		},
		async (a) => run("citas_proximas", () => T.citas_proximas(env, a)),
	);

	server.registerTool(
		"buscar_paciente",
		{
			description: "Busca pacientes por nombre, apellido o celular. Devuelve hasta 5: alias o nombre, File y últimos 4 dígitos del celular.",
			inputSchema: { texto: z.string().min(3).max(80) },
			annotations: soloLectura,
		},
		async (a) => run("buscar_paciente", () => T.buscar_paciente(env, a)),
	);

	server.registerTool(
		"citas_paciente",
		{
			description: "Próximas y últimas citas de un paciente por su File (F-número).",
			inputSchema: { file },
			annotations: soloLectura,
		},
		async (a) => run("citas_paciente", () => T.citas_paciente(env, a)),
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
		async (a) => run("huecos", () => T.huecos(env, a)),
	);

	server.registerTool(
		"dentistas",
		{
			description: "Catálogo de profesionales con su id, especialidad y si están habilitados.",
			inputSchema: {},
			annotations: soloLectura,
		},
		async () => run("dentistas", () => T.dentistas(env)),
	);

	server.registerTool(
		"laboratorio_paciente",
		{
			description:
				"Trabajos de laboratorio de un paciente por File: prestaciones de sus planes activos con su estado y el estado de la solicitud a laboratorio en Dentalink (si se registró).",
			inputSchema: { file },
			annotations: soloLectura,
		},
		async (a) => run("laboratorio_paciente", () => T.laboratorio_paciente(env, a)),
	);

	server.registerTool(
		"laboratorios",
		{
			description: "Catálogo de laboratorios dados de alta en Dentalink.",
			inputSchema: {},
			annotations: soloLectura,
		},
		async () => run("laboratorios", () => T.laboratorios(env)),
	);

	return server;
}
