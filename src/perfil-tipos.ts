/** Tipos del perfil (NVD-TK-41). Aparte para que perfiles.ts y matriz.ts no se importen en circulo. */
export const PERFILES = ["Dirección", "Jefatura administrativa", "Auxiliar administrativa", "Atención a Clientes", "Doctor", "Auxiliar clínico", "Laboratorio"] as const;
export type NombrePerfil = (typeof PERFILES)[number];

export type Perfil = {
	correo: string;
	perfil: NombrePerfil;
	registra_pagos: boolean;
	anula: boolean;
	escribe_evoluciones: boolean;
};
