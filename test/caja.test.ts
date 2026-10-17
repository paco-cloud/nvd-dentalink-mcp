import { test } from "node:test";
import assert from "node:assert/strict";
import { cuadrarCaja, escaladoPorDiferencia, FONDO_ESTANDAR } from "../src/caja.ts";

const base = { efectivoDentalink: 5000, retiroContado: 5000, fondoContado: 1000, fondoAnterior: 1000 };

test("cuadra cuando lo contado coincide con lo esperado", () => {
	const r = cuadrarCaja(base);
	assert.equal(r.esperado, 6000);
	assert.equal(r.diferencia, 0);
	assert.equal(r.estado, "Cuadra");
	assert.equal(r.escalado, "No aplica");
	assert.equal(r.incidencia, false);
	assert.equal(r.fondoSupuesto, false);
});

test("faltante y sobrante por el signo de la diferencia", () => {
	assert.equal(cuadrarCaja({ ...base, retiroContado: 4900 }).estado, "Faltante");
	assert.equal(cuadrarCaja({ ...base, retiroContado: 4900 }).diferencia, -100);
	assert.equal(cuadrarCaja({ ...base, retiroContado: 5100 }).estado, "Sobrante");
	assert.equal(cuadrarCaja({ ...base, retiroContado: 5100 }).diferencia, 100);
});

test("diferencia cero con fondo distinto al estandar es Fondo a reacomodar", () => {
	// El retiro absorbe los 100 que le faltan al fondo: la caja cuadra, el fondo no.
	const r = cuadrarCaja({ ...base, retiroContado: 5100, fondoContado: 900 });
	assert.equal(r.diferencia, 0);
	assert.equal(r.estado, "Fondo a reacomodar");
	assert.equal(r.incidencia, false);
});

test("sin retiro anterior se asume el fondo estandar y se marca supuesto", () => {
	const r = cuadrarCaja({ ...base, fondoAnterior: null });
	assert.equal(r.esperado, 5000 + FONDO_ESTANDAR);
	assert.equal(r.fondoSupuesto, true);
	assert.equal(r.estado, "Cuadra");
});

test("umbrales de escalado, incluidos los bordes", () => {
	assert.equal(escaladoPorDiferencia(0), "No aplica");
	assert.equal(escaladoPorDiferencia(50), "No aplica");
	assert.equal(escaladoPorDiferencia(50.01), "Primer nivel");
	assert.equal(escaladoPorDiferencia(200), "Primer nivel");
	assert.equal(escaladoPorDiferencia(200.01), "Segundo nivel");
	// El escalado va por valor absoluto: un faltante escala igual que un sobrante.
	assert.equal(escaladoPorDiferencia(-50), "No aplica");
	assert.equal(escaladoPorDiferencia(-200.01), "Segundo nivel");
});

test("los centavos no dejan residuo de punto flotante", () => {
	// En pesos, 1000.2 + 999.9 - (1000.1 + 1000) no da 0 y la caja se marcaria Sobrante.
	const r = cuadrarCaja({
		efectivoDentalink: 1000.1,
		retiroContado: 1000.2,
		fondoContado: 999.9,
		fondoAnterior: 1000,
	});
	assert.equal(r.diferencia, 0);
	assert.equal(r.estado, "Fondo a reacomodar");
});

test("centavos reales: 0.05 de faltante", () => {
	const r = cuadrarCaja({ ...base, retiroContado: 4999.95 });
	assert.equal(r.diferencia, -0.05);
	assert.equal(r.estado, "Faltante");
	assert.equal(r.escalado, "No aplica");
	assert.equal(r.incidencia, true);
});

test("entradas que no son numeros finitos se rechazan", () => {
	assert.throws(() => cuadrarCaja({ ...base, retiroContado: Number.NaN }), TypeError);
	assert.throws(() => cuadrarCaja({ ...base, fondoContado: Number.POSITIVE_INFINITY }), TypeError);
	assert.throws(() => cuadrarCaja({ ...base, fondoAnterior: Number.NaN }), TypeError);
});
