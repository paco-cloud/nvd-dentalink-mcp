# NVD-TK-41 · Fase 5 · Batería en vivo

La batería ya corre en automático (`test/bateria.test.ts`, modo activo, Sheets y Dentalink
simulados). Esta guía es la corrida **en vivo** contra el conector desplegado, para la
evidencia que pide Mel antes de pasar a modo activo.

## Una sola cuenta de prueba

En vez de una cuenta por perfil (8 licencias de Google y 8 asientos de Claude) se usa
**una** cuenta, `prueba.conector@novodent.mx`, y se le cambia el perfil en
`USUARIOS_ROLES` entre caso y caso. La prueba se hace con **MCP Inspector**, que llama a
las herramientas directo y muestra la respuesta cruda: no necesita asiento de Claude y la
evidencia no depende de lo que interprete un asistente.

- El perfil se lee de la hoja con cache de **5 minutos por isolate**: después de cambiar la
  fila hay que esperar 5 minutos antes del siguiente caso.
- `prueba.conector@` ya está en `ALLOWED_EMAILS` (`wrangler.jsonc`). Fuera de la prueba su
  fila queda con `activo = FALSE`, así que el filtro la niega aunque entre.
- Pacientes: sólo Files de prueba (F-9001 a F-9099) o búsquedas sin resultados. Nunca un
  paciente real en la evidencia.

## Preparación

1. Cuenta `prueba.conector@novodent.mx` en Google Admin (Paco).
2. La cuenta en la política de Access «Equipo autorizado · Conector Dentalink» (Paco).
3. Fila en `USUARIOS_ROLES`: correo, `activo = TRUE`, perfil del primer caso.
4. `PERFILES_MODO = activo` **sólo durante la prueba**, editando la variable en el panel del
   Worker. El siguiente deploy desde el repo la regresa a `sombra`.
5. Inspector en la terminal de Paco:
   ```bash
   npx @modelcontextprotocol/inspector@latest
   ```
   Transporte «Streamable HTTP», URL `https://nvd-dentalink-mcp.novomedia.workers.dev/mcp`,
   «Connect», y entrar con `prueba.conector@` en Access.

## Casos

| # | Perfil en la fila | Herramienta (Inspector) | Argumentos | Debe | Resultado | Log |
|---:|---|---|---|---|---|---|
| 10 | Dirección | las 9 | por defecto | Todas pasan; `buscar_paciente` con 4 dígitos | | |
| 4 | Atención a Clientes | buscar_paciente | `{"texto":"Prueba"}` | Con `celular_termina_en` · `permitido` | | |
| 2 | Auxiliar clínico | buscar_paciente | `{"texto":"Prueba"}` | Sin `celular_termina_en` · `filtrado` | | |
| 5 | Laboratorio | agenda_dia | `{}` | Sólo prótesis, ortodoncia y cirugía · `filtrado` | | |
| 5b | Laboratorio | dentistas | `{}` | Sólo esas especialidades | | |
| 7 | Por confirmar | agenda_dia | `{}` | «Sin permiso» · `sin_fila` | | |
| 8 | (fila con `activo = FALSE`) | agenda_dia | `{}` | «Sin permiso» · `sin_fila` | | |
| 11 | Dirección + hoja sin permiso | agenda_dia | `{}` | «Perfil no disponible» · `no_disponible` | | |

El caso 11 se prueba quitando a la cuenta de servicio de la hoja **sólo si Paco lo
aprueba**; si no, queda cubierto por la prueba automática.

Los casos 1, 3, 6, 9 y 12 necesitan herramientas de pagos o de evoluciones, que hoy no
existen: los cubre la prueba automática contra la matriz.

## Criterio de salida y cierre

- 100 % de los casos negados donde debe negarse y 0 respuestas con datos que el perfil no
  puede ver. Cada caso con su línea en el log de Workers (`evento: "herramienta"`).
- Al terminar: `PERFILES_MODO = sombra` en el panel, fila de `prueba.conector@` con
  `activo = FALSE`, y reporte `NVD-DEV-RPT-2026-10-XX-tk41.md` con esta tabla llena.
