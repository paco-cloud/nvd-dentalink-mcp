# NVD-TK-41 · Fase 5 · Batería en vivo con cuentas de prueba

La misma batería ya corre en automático (`test/bateria.test.ts`, modo activo, Sheets y
Dentalink simulados). Esta guía es la corrida **en vivo**, contra el conector desplegado,
para la evidencia que pide Mel antes de pasar a modo activo.

## Antes de empezar (Paco)

1. Cuentas de prueba en Google Admin, una por perfil:
   `prueba.auxclinico@`, `prueba.ac@`, `prueba.lab@`, `prueba.doctor@`, `prueba.direccion@`,
   `prueba.jefatura@`, `prueba.porconfirmar@` (todas @novodent.mx).
2. Cada una con su fila en `NVD · Catálogos › USUARIOS_ROLES` (perfil y `activo = TRUE`;
   `prueba.jefatura@` con `puede_registrar_pagos = TRUE`). Para el caso 8 se usa una
   cuenta **sin fila**: `prueba.sinfila@`.
3. Las 8 cuentas en la política de Access «Equipo autorizado · Conector Dentalink» y en
   `ALLOWED_EMAILS` (`wrangler.jsonc`), con deploy.
4. `PERFILES_MODO=activo` **sólo durante la prueba** (variable del panel o deploy). Al
   terminar, volver a `sombra` hasta el OK de Mel.
5. Pacientes: sólo Files de prueba (F-9001 a F-9099). Nunca un paciente real.

## Cómo correr cada caso

Con la cuenta de prueba, en Claude con el conector «Novodent · Dentalink» conectado,
escribir la petición literal. Anotar lo que responde el conector (no lo que interpreta el
asistente) y la fila que aparece en `BITACORA_CONSULTAS` al día siguiente (o en el log de
Workers al momento: `evento: "herramienta"`).

| # | Cuenta | Petición | Debe | Resultado | Bitácora |
|---:|---|---|---|---|---|
| 1 | prueba.auxclinico@ | «Registra un pago de F-9001» | Negar · `perfil_sin_grupo` | | |
| 2 | prueba.auxclinico@ | «Busca al paciente Prueba» | Responde sin `celular_termina_en` · `filtrado` | | |
| 3 | prueba.ac@ | «Registra una evolución para F-9001» | Negar · `perfil_sin_grupo` | | |
| 4 | prueba.ac@ | «Busca al paciente Prueba» | Responde con 4 dígitos del celular · `permitido` | | |
| 5 | prueba.lab@ | «Agenda de hoy» | Sólo prótesis, ortodoncia y cirugía · `filtrado` | | |
| 6 | prueba.lab@ | «Registra un pago de F-9001» | Negar | | |
| 7 | prueba.porconfirmar@ | «Agenda de hoy» | Negar · `sin_fila` | | |
| 8 | prueba.sinfila@ | «Agenda de hoy» | Negar · `sin_fila` | | |
| 9 | prueba.doctor@ | «Registra un pago de F-9001» | Negar | | |
| 10 | prueba.direccion@ | Las 9 herramientas | Todas pasan; celular enmascarado | | |
| 11 | cualquiera | Con `PERFILES_SHEET_ID` apuntando a una hoja sin permiso | «Perfil no disponible» · `no_disponible` | | |
| 12 | prueba.jefatura@ | «Registra un pago de F-9001» | Pasa la compuerta (la herramienta aún no existe: «herramienta no registrada») | | |

**Hoy no existen herramientas de pagos ni de evoluciones.** Los casos 1, 3, 6, 9 y 12 sólo
se pueden comprobar en vivo cuando existan; mientras tanto los cubre la prueba automática
contra la matriz. Lo que sí se comprueba en vivo hoy: 2, 4, 5, 7, 8, 10 y 11.

## Criterio de salida

- 100 % de los casos negados donde debe negarse y 0 respuestas con datos que el perfil no
  puede ver.
- Cada caso con su fila en la bitácora.
- Al terminar: `PERFILES_MODO=sombra`, quitar las cuentas de prueba de Access y de
  `ALLOWED_EMAILS` (o dejarlas inactivas en `USUARIOS_ROLES`), y reporte
  `NVD-DEV-RPT-2026-10-XX-tk41.md` con esta tabla llena.
