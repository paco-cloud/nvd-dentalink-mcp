/**
 * Segunda barrera despues de la politica de Access (fase 2).
 * Se revisa al iniciar sesion y en cada llamada a /mcp.
 */
export function allowedEmails(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? "")
			.split(",")
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean),
	);
}

export function isAllowed(raw: string | undefined, email: unknown): boolean {
	return typeof email === "string" && allowedEmails(raw).has(email.trim().toLowerCase());
}
