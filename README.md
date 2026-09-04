# TuCajeroV3

Punto de Venta de escritorio (Electron + React + tRPC + SQLite).

## Requisitos

- Node.js ≥ 20 y npm
- `better-sqlite3` se compila para el ABI de Electron (`npm install`); los tests de
  servicio que tocan la base de datos requieren correr bajo ese ABI (ver *Tests*).

## Desarrollo

```bash
npm install
npm run dev        # renderer (Vite) + proceso principal (Electron)
```

La app lee `LICENSE_SECRET` del entorno del proceso principal. Para desarrollo,
copia `.env.example` a `.env` y define el secreto (se carga automáticamente en
`npm run dev`):

```bash
# .env
LICENSE_SECRET=<secreto-de-al-menos-16-caracteres>
```

Sin `LICENSE_SECRET` la app no valida ninguna licencia (fail closed). Debe ser el
mismo secreto que el **KeyGen** (`KeyGen/.env`) usa para firmar licencias.

## Licencias

1. El cliente instala la app y copia su **fingerprint** (pestaña *Licencia* → *Copiar fingerprint*).
2. Genera la licencia con el KeyGen (`npm run keygen`) usando los meses deseados.
3. El cliente la pega en *Licencia* → *Activar*.

Ver `KeyGen/README.md` para los pasos del KeyGen.

## Empaquetar

```bash
npm run dist      # instalador + portable
```

En el binario empaquetado, `LICENSE_SECRET` se inyecta al arrancar como variable
de entorno del proceso principal (no está embebido en el binario):

```powershell
$env:LICENSE_SECRET="<secreto>"
.\TuCajero.exe
```

## Tests

```bash
npm test
```

`better-sqlite3` está compilado para el ABI de Electron, así que con el Node del
sistema los tests de servicio se saltan. Para ejecutarlos completos (el ABI de
Electron coincide):

```powershell
$env:ELECTRON_RUN_AS_NODE="1"
npx vitest run
```

## Verificación

```bash
npm run typecheck        # proyecto completo
npm run typecheck:main   # solo proceso principal
npm run lint
```
