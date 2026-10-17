/**
 * Cuadre de caja (NIA-DEV-008, A paso 3). Funcion pura: no consulta Dentalink
 * ni escribe en Monday, solo calcula a partir de lo ya medido.
 *
 * Todo se calcula en centavos enteros. En pesos con decimales la resta deja
 * residuos de punto flotante y un cuadre exacto se marcaria como Sobrante.
 */

/** Fondo con el que abre cada caja. */
export const FONDO_ESTANDAR = 1000;

const TOPE_SIN_ESCALADO = 50;
const TOPE_PRIMER_NIVEL = 200;

export type Estado = "Faltante" | "Sobrante" | "Fondo a reacomodar" | "Cuadra";
export type Escalado = "No aplica" | "Primer nivel" | "Segundo nivel";

export interface EntradaCuadre {
	/** Efectivo cobrado por esa caja en el periodo, segun Dentalink. */
	efectivoDentalink: number;
	retiroContado: number;
	fondoContado: number;
	/** Fondo contado del retiro anterior de esa caja; null si no hay. */
	fondoAnterior: number | null;
}

export interface ResultadoCuadre {
	esperado: number;
	diferencia: number;
	estado: Estado;
	escalado: Escalado;
	incidencia: boolean;
	/** true cuando no habia retiro anterior y se asumio el fondo estandar. */
	fondoSupuesto: boolean;
}

function aCentavos(valor: number, campo: string): number {
	if (typeof valor !== "number" || !Number.isFinite(valor)) {
		throw new TypeError(`${campo}: se esperaba un numero finito`);
	}
	return Math.round(valor * 100);
}

function escaladoDeCentavos(absCentavos: number): Escalado {
	if (absCentavos <= TOPE_SIN_ESCALADO * 100) return "No aplica";
	if (absCentavos <= TOPE_PRIMER_NIVEL * 100) return "Primer nivel";
	return "Segundo nivel";
}

/** Nivel de escalado por el valor absoluto de la diferencia, en pesos. */
export function escaladoPorDiferencia(diferencia: number): Escalado {
	return escaladoDeCentavos(Math.abs(aCentavos(diferencia, "diferencia")));
}

export function cuadrarCaja(entrada: EntradaCuadre): ResultadoCuadre {
	const efectivo = aCentavos(entrada.efectivoDentalink, "efectivoDentalink");
	const retiro = aCentavos(entrada.retiroContado, "retiroContado");
	const fondo = aCentavos(entrada.fondoContado, "fondoContado");
	const fondoSupuesto = entrada.fondoAnterior === null;
	const fondoInicial =
		entrada.fondoAnterior === null
			? FONDO_ESTANDAR * 100
			: aCentavos(entrada.fondoAnterior, "fondoAnterior");

	const esperado = efectivo + fondoInicial;
	const diferencia = retiro + fondo - esperado;

	// El orden importa: "Fondo a reacomodar" se evalua antes que "Cuadra".
	// Al reves, todo lo que cuadre se marca Cuadra aunque el fondo este mal.
	let estado: Estado;
	if (diferencia < 0) estado = "Faltante";
	else if (diferencia > 0) estado = "Sobrante";
	else if (fondo !== FONDO_ESTANDAR * 100) estado = "Fondo a reacomodar";
	else estado = "Cuadra";

	return {
		esperado: esperado / 100,
		diferencia: diferencia / 100,
		estado,
		escalado: escaladoDeCentavos(Math.abs(diferencia)),
		incidencia: diferencia !== 0,
		fondoSupuesto,
	};
}
