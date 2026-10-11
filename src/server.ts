import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { DentalinkError, dentalinkGet, pick } from "./dentalink.ts";

/**
 * Las herramientas. Cada una:
 *  - solo hace GET a Dentalink,
 *  - devuelve solo los campos de su lista blanca,
 *  - deja en el log el nombre de la herramienta y el correo, nada mas.
 *
 * FASE 1 (NVD-TK-17a, B1): solo `dentistas`, para probar el inicio de sesion
 * con Claude. Las otras 8 se portan de nvd-mcp.js.
 */

// VERIFICAR contra la lista blanca de nvd-mcp.js.
const CAMPOS_DENTISTA = ["id", "nombre", "apellidos", "especialidad", "habilitado"] as const;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function logUso(herramienta: string): void {
	const email = getMcpAuthContext()?.props?.email;
	console.log(JSON.stringify({ evento: "herramienta", herramienta, correo: typeof email === "string" ? email : null }));
}

function ok(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fallo(err: unknown): ToolResult {
	// Sin detalle de la respuesta de Dentalink: puede traer datos.
	const msg = err instanceof DentalinkError ? `Dentalink no respondio bien (${err.status}).` : "Error al consultar Dentalink.";
	return { content: [{ type: "text", text: msg }], isError: true };
}

async function run(herramienta: string, fn: () => Promise<unknown>): Promise<ToolResult> {
	logUso(herramienta);
	try {
		return ok(await fn());
	} catch (err) {
		return fallo(err);
	}
}

export function createServer(env: Env): McpServer {
	const server = new McpServer({ name: "Novodent · Dentalink", version: "0.1.0" });

	server.registerTool(
		"dentistas",
		{
			description: "Lista de dentistas y profesionales de Novodent en Dentalink (id, nombre, especialidad, si esta habilitado).",
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () =>
			run("dentistas", async () => (await dentalinkGet(env, "dentistas")).map((r) => pick(r, CAMPOS_DENTISTA))),
	);

	return server;
}
