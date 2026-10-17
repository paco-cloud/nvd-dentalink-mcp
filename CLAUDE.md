# CLAUDE.md · nvd-dentalink-mcp

Conector MCP de Dentalink para Claude, sólo lectura, con inicio de sesión por
Cloudflare Access. Novodent: clínica dental de una sola sede en Metepec.
Paco Méndez (Dirección General) decide todo. Cómo está hecho: ver README.md.

## Precondición de datos (Dentalink)
- **Este repo sí lee Dentalink.** La regla «nada de Dentalink» del CLAUDE.md de
  `novodent-mx` es de aquel repo y no aplica aquí.
- Alcance exacto: **sólo lectura** (GET), y sin nombres ni datos clínicos fuera
  del Worker. Lo que sale del Worker se arma campo por campo con lista blanca.
- Identificar pacientes por alias o nombre + File (F-número). Nunca repetir
  celulares completos ni datos clínicos.
- En Monday sólo van File o folio: nunca nombres, teléfonos ni datos clínicos.
- Nada de datos de pacientes en chat, en correo, en el repo ni en los logs.
  El log guarda sólo `{herramienta, correo}`; nunca el contenido de la consulta.

## Reglas duras
1. Secretos: nunca leer, imprimir ni copiar valores de tokens, llaves, `.dev.vars`,
   `.env`, `~/.wrangler` ni el Keychain. Sólo nombres. Si un comando muestra un
   secreto, detenerse. Los secretos viven en `wrangler secret put`, que hace Paco.
   Nombres en uso: DENTALINK_TOKEN, ACCESS_CLIENT_ID, ACCESS_CLIENT_SECRET,
   ACCESS_TOKEN_URL, ACCESS_AUTHORIZATION_URL, ACCESS_JWKS_URL,
   COOKIE_ENCRYPTION_KEY.
2. **Este repositorio es público.** No se suben correos, nombres de personas,
   identificadores de pacientes ni ejemplos de respuesta con datos reales.
   La lista de correos permitidos vive en variables de entorno, no en el código.
3. Prohibido sin autorización explícita de Paco: `wrangler deploy`,
   `versions upload`, `rollback`, `secret put|delete`, `kv|r2 put|delete`,
   cambios de DNS o rutas, `git push`, merge.
4. Escribir sólo donde Paco autorice; antes de escribir, mostrar la lista y
   esperar su OK.
5. Sesiones concurrentes: antes de empezar correr `git status`,
   `git worktree list` y `find . -mmin -45 -not -path './.git/*'`. Si hay
   trabajo reciente de otra sesión, detenerse y preguntar.
6. Evidencia: cada resultado lleva [HECHO · comando · hora] o
   [POR VERIFICAR · quién/cómo]. No inventar.

## Límites de la API de Dentalink
- Sólo GET. Una consulta cada 1.1 s, reintento en 429; máximo 60 por minuto.
- Una barrida que supere ese límite se procesa por lotes con pausa, nunca en paralelo.
- No hay documentación pública de la API [HECHO · búsqueda web · 17-oct-2026]:
  los campos se confirman con una consulta real a un folio de prueba.
- Toda fecha u hora se normaliza a `America/Mexico_City` antes de comparar.

## Comandos
- `npm run check` (type-check + pruebas + `deploy --dry-run`) antes de proponer cambios.
- `npm test` · `npm run type-check` · `npm run dev` para local.
- `npm run deploy` NO se corre desde aquí: lo hace Paco.

## Ramas
- Trabajo en ramas `cambio/*`, prefijo de commit «NVD-» o «NIA-». Nunca push sin OK.
